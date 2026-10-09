import { requireUser } from "@/lib/server/auth";
import { body, handle } from "@/lib/server/http";
import { createRun, listRuns, validateSearch, type SearchInput } from "@/lib/server/runs";
import { apiKey } from "@/lib/server/serpapi";
import { adminClient } from "@/lib/supabase/server";

export async function GET() {
  return handle(async () => {
    await requireUser();
    return listRuns(adminClient());
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const input = await body<Partial<SearchInput> & { confirmed_calls?: unknown }>(req);
    apiKey(); // a run that cannot search must not be created
    const id = await createRun(adminClient(), me, validateSearch(input), input.confirmed_calls);
    return { id };
  });
}
