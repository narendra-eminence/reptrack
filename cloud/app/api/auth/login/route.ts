import { ApiError, body, handle } from "@/lib/server/http";
import { sessionClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  return handle(async () => {
    const { email, password } = await body<{ email?: unknown; password?: unknown }>(req);
    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      throw new ApiError(422, "Enter your email and password.");
    }
    const supabase = await sessionClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      if (error.status === 429) throw new ApiError(429, "Too many attempts. Wait a minute and try again.");
      throw new ApiError(401, "Wrong email or password.");
    }
    return { ok: true };
  });
}
