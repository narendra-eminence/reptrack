import { requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { cancelRun, getRun } from "@/lib/server/runs";
import { adminClient } from "@/lib/supabase/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    const db = adminClient();
    await getRun(db, id);
    await cancelRun(db, id);
    return { cancelled: id };
  });
}
