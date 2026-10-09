import { requireAdmin } from "@/lib/server/auth";
import { body, handle } from "@/lib/server/http";
import { deleteUser, updateUser } from "@/lib/server/users";
import { adminClient } from "@/lib/supabase/server";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;
    await updateUser(adminClient(), me, id, await body<{ role?: unknown; password?: unknown }>(req));
    return { updated: id };
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const me = await requireAdmin();
    const { id } = await params;
    await deleteUser(adminClient(), me, id);
    return { deleted: id };
  });
}
