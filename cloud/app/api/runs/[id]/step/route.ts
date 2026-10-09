import { requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { step } from "@/lib/server/runs";
import { adminClient } from "@/lib/supabase/server";

// One query per call: up to 50 SerpAPI pages with retries. The step stops starting new pages at 240 s, inside the
// 300 s every Vercel plan allows.
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    return { step: await step(adminClient(), id) }; // 404 for an unknown run
  });
}
