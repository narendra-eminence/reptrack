import "server-only";
import { adminClient, sessionClient } from "@/lib/supabase/server";
import { ApiError } from "./http";

export type Role = "admin" | "member";
export interface Me {
  id: string;
  email: string;
  role: Role;
}

/** The signed-in user and their role, or a 401. The role is read with the service client from profiles, which
 * only admins can change. */
export async function requireUser(): Promise<Me> {
  const supabase = await sessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "You are signed out. Sign in again to continue.");
  const { data: profile } = await adminClient().from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!profile) throw new ApiError(403, "This account has no profile. Ask an admin to recreate it.");
  return { id: data.user.id, email: data.user.email ?? "", role: profile.role as Role };
}

export async function requireAdmin(): Promise<Me> {
  const me = await requireUser();
  if (me.role !== "admin") throw new ApiError(403, "Only admins can manage users.");
  return me;
}

/** The signed-in user for a page render, or null. */
export async function currentUser(): Promise<Me | null> {
  try {
    return await requireUser();
  } catch {
    return null;
  }
}
