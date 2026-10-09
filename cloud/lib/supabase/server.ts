import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { required, supabaseAnonKey, supabaseUrl } from "./env";

/** The signed-in user's client: reads the session from cookies and refreshes it when it can. */
export async function sessionClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;

/** Service-role client for server routes, used only after the route has checked who is signed in. It bypasses
 * row-level security, so it must never reach the browser. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(
    supabaseUrl(),
    required("SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)", process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return admin;
}
