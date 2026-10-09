import { requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { deleteRun, getRun } from "@/lib/server/runs";
import { adminClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireUser();
    return getRun(adminClient(), (await params).id);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await params;
    await deleteRun(adminClient(), me, id);
    return { deleted: id };
  });
}
