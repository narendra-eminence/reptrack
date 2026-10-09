import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REGIONS, VERTICALS, buildParams, maxCalls, pageParams, pagesFor, parseQueries, runQuery, type Region, type SerpRow,
  type Vertical,
} from "@/lib/serp/core";
import { isIsoDate } from "@/lib/serp/dates";
import type { Me } from "./auth";
import { ApiError, check, need } from "./http";
import { cacheKey, countCached, serpApiFetcher } from "./serpapi";

export const MAX_QUERIES = 2_000;
/** Rows per request: hosted Supabase caps a response at 1,000 rows. */
export const PAGE = 1_000;
/** Vercel stops a function at its maxDuration (300 s on Hobby). A step stops starting new pages well before. */
export const STEP_BUDGET_MS = 240_000;

export interface SearchInput {
  queries: string;
  vertical: Vertical;
  region: Region;
  pages: number | string;
  start: string;
  end: string;
}

export interface SearchRequest {
  queries: string[];
  vertical: Vertical;
  region: Region;
  pages: number;
  start: string;
  end: string;
}

export function validateSearch(input: Partial<SearchInput>): SearchRequest {
  const queries = parseQueries(typeof input.queries === "string" ? input.queries : "");
  if (!queries.length) throw new ApiError(422, "Enter at least one query (one per line).");
  if (queries.length > MAX_QUERIES) throw new ApiError(422, `At most ${MAX_QUERIES} queries per run; this has ${queries.length}.`);
  const vertical = input.vertical as Vertical;
  if (!VERTICALS.includes(vertical)) throw new ApiError(422, `Unknown vertical ${JSON.stringify(input.vertical)}.`);
  const region = input.region as Region;
  if (!(region in REGIONS)) throw new ApiError(422, `Unknown region ${JSON.stringify(input.region)}.`);
  const start = (input.start ?? "").trim();
  const end = (input.end ?? "").trim();
  if (!!start !== !!end) throw new ApiError(422, "Start and end dates go together: fill both or leave both empty.");
  for (const [label, d] of [["Start", start], ["End", end]] as const) {
    if (d && !isIsoDate(d)) throw new ApiError(422, `${label} date ${JSON.stringify(d)} is not a valid YYYY-MM-DD date.`);
  }
  if (start && start > end) throw new ApiError(422, `Start date ${start} is after end date ${end}.`);
  return { queries, vertical, region, pages: pagesFor(vertical, input.pages), start, end };
}

/** Cost preview: the most billable SerpAPI pages the run can use, and how many of those are cached (free). */
export async function plan(db: SupabaseClient, req: SearchRequest) {
  const keys = req.queries.flatMap((q) => {
    const base = buildParams(q, req.start, req.end, req.vertical, req.region);
    return Array.from({ length: req.pages }, (_, i) => cacheKey(pageParams(base, i)));
  });
  return {
    queries: req.queries,
    count: req.queries.length,
    pages: req.pages,
    max_calls: maxCalls(req.queries.length, req.pages),
    cached_calls: await countCached(db, keys),
  };
}

export async function createRun(db: SupabaseClient, me: Me, req: SearchRequest, confirmedCalls: unknown): Promise<string> {
  const ceiling = maxCalls(req.queries.length, req.pages);
  if (confirmedCalls !== ceiling) {
    throw new ApiError(409, `This search can make up to ${ceiling} billable SerpAPI page requests. Confirm that figure to start.`, {
      max_calls: ceiling,
    });
  }
  const run = need(
    await db
      .from("runs")
      .insert({
        name: req.queries[0].slice(0, 80),
        vertical: req.vertical,
        region: req.region,
        pages: req.pages,
        start_date: req.start || null,
        end_date: req.end || null,
        max_calls: ceiling,
        created_by: me.id,
        created_by_email: me.email,
      })
      .select("id")
      .single(),
    "create run",
  );
  const rows = req.queries.map((text, position) => ({ run_id: run.id, position, text }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("queries").insert(rows.slice(i, i + 500));
    if (error) {
      await db.from("runs").delete().eq("id", run.id); // all or nothing
      throw new Error(`create queries: ${error.message}`);
    }
  }
  return run.id as string;
}

/** Run ids are uuids; anything else is a 404 rather than a database error. */
function validRunId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApiError(404, "No such run.");
  return id;
}

export async function getRun(db: SupabaseClient, id: string) {
  validRunId(id);
  const run = check(await db.from("run_overview").select("*").eq("id", id).maybeSingle(), "load run");
  if (!run) throw new ApiError(404, "No such run. It may have been deleted.");
  // Hosted Supabase returns at most 1,000 rows per request, so a large run's queries are read in pages.
  const queries: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = need(
      await db
        .from("queries")
        .select("id, position, text, state, found, out_of_range, attempts, calls, error, started_at, finished_at")
        .eq("run_id", id)
        .order("position")
        .range(from, from + PAGE - 1),
      "load queries",
    );
    queries.push(...page);
    if (page.length < PAGE) break;
  }
  // The server's clock, so the browser can judge how old a claim is without trusting its own clock.
  return { ...run, queries, now: new Date().toISOString() };
}

export async function listRuns(db: SupabaseClient) {
  return need(
    await db
      .from("run_overview")
      .select("id, name, vertical, region, pages, start_date, end_date, status, created_by_email, created_at, updated_at, query_count, done_count, failed_count, pending_count, running_count, row_count, calls_used")
      .order("created_at", { ascending: false })
      .limit(500),
    "list runs",
  );
}

interface ClaimedQuery {
  id: number;
  run_id: string;
  position: number;
  text: string;
}

/**
 * Claim and search one query of a run, then store its rows. The browser calls this repeatedly (a few at a time)
 * while the run page is open; each call is short enough for one Vercel function. Returns null when nothing is
 * left to claim (finished, cancelled, or every remaining query is being worked by another step).
 */
export async function step(db: SupabaseClient, runId: string) {
  const startedAt = Date.now();
  validRunId(runId);
  const run = check(await db.from("runs").select("*").eq("id", runId).maybeSingle(), "load run");
  if (!run) throw new ApiError(404, "No such run. It may have been deleted.");
  const claimed = check(await db.rpc("claim_next_query", { p_run: runId }), "claim query") as ClaimedQuery[];
  const q = claimed[0];
  if (!q) return null;
  let out: { rows: SerpRow[]; error: string; attempts: number; calls: number };
  try {
    out = await runQuery(
      {
        query: q.text,
        start: run.start_date ?? "",
        end: run.end_date ?? "",
        pages: run.pages,
        vertical: run.vertical,
        region: run.region,
      },
      serpApiFetcher(db),
      { deadline: startedAt + STEP_BUDGET_MS },
    );
  } catch (e) {
    out = { rows: [], error: e instanceof ApiError ? e.message : "search failed unexpectedly", attempts: 1, calls: 0 };
    if (!(e instanceof ApiError)) console.error(e);
  }
  check(
    await db.rpc("finish_query", {
      p_query: q.id,
      p_state: out.error ? "failed" : "done",
      p_attempts: out.attempts,
      p_calls: out.calls,
      p_error: out.error,
      p_rows: out.rows,
    }),
    "store results",
  );
  return { query_id: q.id, position: q.position, found: out.rows.length, error: out.error, calls: out.calls };
}

export async function cancelRun(db: SupabaseClient, runId: string) {
  validRunId(runId);
  check(
    await db.from("runs").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", runId).in("status", ["pending", "running"]),
    "cancel run",
  );
}

export async function resumeRun(db: SupabaseClient, runId: string, includeFailed: boolean) {
  validRunId(runId);
  return check(await db.rpc("resume_run", { p_run: runId, p_include_failed: includeFailed }), "resume run") as number;
}

export async function deleteRun(db: SupabaseClient, me: Me, runId: string) {
  validRunId(runId);
  const run = check(await db.from("runs").select("created_by").eq("id", runId).maybeSingle(), "load run");
  if (!run) throw new ApiError(404, "No such run. It may have been deleted.");
  if (me.role !== "admin" && run.created_by !== me.id) throw new ApiError(403, "Only the person who started a run, or an admin, can delete it.");
  check(await db.from("runs").delete().eq("id", runId), "delete run");
}

const ROW_COLUMNS =
  "query, vertical, provider, page, rank, title, link, domain, date, published, out_of_range, range_start, range_end, snippet, outlet, fetched_at";

export async function rowsPage(db: SupabaseClient, runId: string, offset: number, limit: number, q: string) {
  validRunId(runId);
  let query = db
    .from("serp_rows")
    .select(ROW_COLUMNS, { count: "exact" })
    .eq("run_id", runId)
    .order("query_position")
    .order("seq")
    .range(offset, offset + limit - 1);
  const needle = q.trim().toLowerCase();
  if (needle) query = query.ilike("search_text", `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const res = await query;
  if (res.error) throw new Error(`load rows: ${res.error.message}`);
  return { total: res.count ?? 0, offset, limit, rows: res.data ?? [] };
}
