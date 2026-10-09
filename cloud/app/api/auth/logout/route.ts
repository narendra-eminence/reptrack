import { handle } from "@/lib/server/http";
import { sessionClient } from "@/lib/supabase/server";

export async function POST() {
  return handle(async () => {
    await (await sessionClient()).auth.signOut();
    return { ok: true };
  });
}
