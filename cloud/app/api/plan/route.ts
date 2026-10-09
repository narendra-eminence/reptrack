import { requireUser } from "@/lib/server/auth";
import { body, handle } from "@/lib/server/http";
import { plan, validateSearch, type SearchInput } from "@/lib/server/runs";
import { adminClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    return plan(adminClient(), validateSearch(await body<Partial<SearchInput>>(req)));
  });
}
