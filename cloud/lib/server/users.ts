import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me, Role } from "./auth";
import { ApiError, check, need } from "./http";

export const MIN_PASSWORD = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) throw new ApiError(422, "Enter a valid email address.");
  return email;
}

export function validPassword(raw: unknown): string {
  const password = typeof raw === "string" ? raw : "";
  if (password.length < MIN_PASSWORD) throw new ApiError(422, `Passwords need at least ${MIN_PASSWORD} characters.`);
  return password;
}

export function validRole(raw: unknown): Role {
  if (raw !== "admin" && raw !== "member") throw new ApiError(422, 'Role must be "admin" or "member".');
  return raw;
}

export interface UserRow {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function listUsers(db: SupabaseClient): Promise<UserRow[]> {
  const profiles = need(await db.from("profiles").select("id, email, role, created_at").order("created_at"), "list profiles");
  const lastSignIn = new Map<string, string | null>();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    for (const u of data.users) lastSignIn.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 1000) break;
  }
  return profiles.map((p) => ({ ...p, last_sign_in_at: lastSignIn.get(p.id) ?? null }));
}

/** Accounts exist only because an admin made them: sign-ups are switched off in Supabase Auth. */
export async function createUser(db: SupabaseClient, email: string, password: string, role: Role): Promise<UserRow> {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    if (/already (been )?registered|already exists/i.test(error.message)) throw new ApiError(409, `${email} already has an account.`);
    throw new ApiError(422, error.message);
  }
  const id = data.user.id;
  // The on_auth_user_created trigger made the profile as a member.
  if (role !== "member") check(await db.from("profiles").update({ role }).eq("id", id), "set role");
  const profile = need(await db.from("profiles").select("id, email, role, created_at").eq("id", id).single(), "load profile");
  return { ...profile, last_sign_in_at: null };
}

async function adminCount(db: SupabaseClient): Promise<number> {
  const { count, error } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  if (error) throw new Error(`count admins: ${error.message}`);
  return count ?? 0;
}

async function profileOf(db: SupabaseClient, id: string) {
  const p = check(await db.from("profiles").select("id, email, role").eq("id", id).maybeSingle(), "load profile");
  if (!p) throw new ApiError(404, "No such user.");
  return p as { id: string; email: string; role: Role };
}

export async function updateUser(db: SupabaseClient, me: Me, id: string, patch: { role?: unknown; password?: unknown }) {
  const target = await profileOf(db, id);
  if (patch.role !== undefined) {
    const role = validRole(patch.role);
    if (target.role === "admin" && role !== "admin") {
      if (target.id === me.id) throw new ApiError(409, "You cannot remove your own admin role. Ask another admin.");
      if ((await adminCount(db)) <= 1) throw new ApiError(409, "This is the last admin; make someone else admin first.");
    }
    check(await db.from("profiles").update({ role }).eq("id", id), "set role");
  }
  if (patch.password !== undefined) {
    const { error } = await db.auth.admin.updateUserById(id, { password: validPassword(patch.password) });
    if (error) throw new ApiError(422, error.message);
  }
}

export async function deleteUser(db: SupabaseClient, me: Me, id: string) {
  const target = await profileOf(db, id);
  if (target.id === me.id) throw new ApiError(409, "You cannot delete your own account.");
  if (target.role === "admin" && (await adminCount(db)) <= 1) throw new ApiError(409, "This is the last admin and cannot be deleted.");
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) throw new ApiError(422, error.message);
}
