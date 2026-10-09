import { requireUser } from "@/lib/server/auth";
import { body, handle } from "@/lib/server/http";
import { getRun, resumeRun } from "@/lib/server/runs";
import { adminClient } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    const { include_failed = true } = await body<{ include_failed?: boolean }>(req).catch(() => ({ include_failed: true }));
    const db = adminClient();
    await getRun(db, id);
    return { requeued: await resumeRun(db, id, include_failed !== false) };
  });
}
