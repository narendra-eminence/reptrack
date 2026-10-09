import { requireUser } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { PAGE, rowsPage } from "@/lib/server/runs";
import { adminClient } from "@/lib/supabase/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    const url = new URL(req.url);
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
    const limit = Math.min(PAGE, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    return rowsPage(adminClient(), id, offset, limit, url.searchParams.get("q") ?? "");
  });
}
