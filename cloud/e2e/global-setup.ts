import { ADMIN, serviceClient } from "./tests/helpers";

/**
 * Empties the database and creates the admin the tests sign in with. It deletes every user and run, so it refuses
 * to touch anything but a Supabase on this machine.
 */
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is not set; use the values from \`npx supabase status\`.`);
  }
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`E2E tests wipe the database; refusing to run against ${url}. Use a local Supabase.`);
  }
  const db = serviceClient();
  const wipe = async (what: string, p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`wipe ${what}: ${error.message}`);
  };
  await wipe("runs", db.from("runs").delete().not("id", "is", null));
  await wipe("cache", db.from("serp_cache").delete().neq("key", ""));
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(`list users: ${error.message}`);
    if (!data.users.length) break;
    for (const u of data.users) {
      const { error: e } = await db.auth.admin.deleteUser(u.id);
      if (e) throw new Error(`delete user: ${e.message}`);
    }
  }
  const { data, error } = await db.auth.admin.createUser({ email: ADMIN.email, password: ADMIN.password, email_confirm: true });
  if (error) throw new Error(`create admin: ${error.message}`);
  await wipe("admin role", db.from("profiles").update({ role: "admin" }).eq("id", data.user.id));
}
