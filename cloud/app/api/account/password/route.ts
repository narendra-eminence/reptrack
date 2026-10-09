import { requireUser } from "@/lib/server/auth";
import { ApiError, body, handle } from "@/lib/server/http";
import { validPassword } from "@/lib/server/users";
import { adminClient, sessionClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

/** Change your own password. The current one is checked first, so a session left open on a shared machine cannot
 * be used to take over the account. */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const { current, next } = await body<{ current?: unknown; next?: unknown }>(req);
    const password = validPassword(next);
    if (typeof current !== "string" || !current) throw new ApiError(422, "Enter your current password.");
    const probe = createClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: wrong } = await probe.auth.signInWithPassword({ email: me.email, password: current });
    // 422, not 401: the browser treats 401 as "signed out" and would send them to the login page.
    if (wrong) throw new ApiError(422, "Your current password is not right.");
    const { error } = await adminClient().auth.admin.updateUserById(me.id, { password });
    if (error) throw new ApiError(422, error.message);
    // Supabase ends every session of the account when its password changes. Sign this browser back in, so only
    // the other devices are signed out.
    const { error: again } = await (await sessionClient()).auth.signInWithPassword({ email: me.email, password });
    if (again) throw new ApiError(401, "Password changed. Sign in again with the new one.");
    return { ok: true };
  });
}
