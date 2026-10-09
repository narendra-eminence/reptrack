/**
 * SerpAPI bulk search: query parsing, request parameters, pagination and result rows.
 *
 * A port of the parts of Company Monitor's bulk_search.py that the RepScore pipeline uses, so this app has no
 * Python dependency. Behaviour is pinned to the Python by __fixtures__/golden.json (scripts/
 * golden_from_company_monitor.py regenerates it). Everything here is pure: the network and the cache come in as a
 * PageFetcher, so the same code runs in a route handler and in tests.
 *
 * Verticals:
 *   web      engine=google           paginates; tbs=cdr date window; display-string dates only.
 *   news     engine=google_news      exact iso_date, ~100 results in ONE call, no pagination and no date
 *                                    parameter: the window goes into the query as after:/before: operators.
 *   news_tab engine=google&tbm=nws   Google's news tab; paginates and honours tbs=cdr.
 */

import { nextDay, publishedDate, rangeFlag } from "./dates";

export const PAGE_SIZE = 10;
/** Spend guard on pages per query (about 500 results), not a technical limit. */
export const MAX_PAGES = 50;
export const QUERY_ATTEMPTS = 3;
export const RETRY_BACKOFF_MS = 2_000;

export const VERTICALS = ["web", "news", "news_tab"] as const;
export type Vertical = (typeof VERTICALS)[number];
export const VERTICAL_LABEL: Record<Vertical, string> = { web: "Web", news: "News", news_tab: "News tab" };

export const REGIONS = {
  in: { label: "India", gl: "in", hl: "en" },
  us: { label: "United States", gl: "us", hl: "en" },
} as const;
export type Region = keyof typeof REGIONS;

export const EXPORT_COLUMNS = [
  "Query", "Vertical", "Provider", "Page", "Rank", "Date", "Published", "Outside Range", "Domain", "Outlet", "Title",
  "Snippet", "Link", "Fetched At",
] as const;

export type Params = Record<string, string>;

export interface SerpRow {
  query: string;
  vertical: Vertical;
  provider: "serpapi";
  page: number;
  rank: number;
  title: string;
  link: string;
  domain: string;
  date: string;
  published: string | null;
  out_of_range: boolean | null;
  range_start: string;
  range_end: string;
  snippet: string;
  outlet: string;
  fetched_at: string;
}

/** Split a pasted blob into queries. Commas and new lines both separate (a comma inside a quoted phrase splits it:
 * use new lines for those). Quotes are stripped only when they wrap the whole query. Duplicates are dropped. */
export function parseQueries(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.replace(/,/g, "\n").split("\n")) {
    let q = line.trim();
    if (q.length >= 2 && q[0] === '"' && q[q.length - 1] === '"' && !q.slice(1, -1).includes('"')) q = q.slice(1, -1).trim();
    if (q && !seen.has(q)) {
      seen.add(q);
      out.push(q);
    }
  }
  return out;
}

/** Pages actually fetched for a vertical: news has no second page, so it is always 1; others clamp to 1..50, and
 * anything unreadable becomes 1, the cheapest option. */
export function pagesFor(vertical: Vertical, value: unknown): number {
  if (vertical === "news") return 1;
  const n = typeof value === "number" ? Math.trunc(value) : typeof value === "string" && /^\s*-?\d+\s*$/.test(value) ? parseInt(value, 10) : NaN;
  if (Number.isNaN(n)) return 1;
  return Math.max(1, Math.min(n, MAX_PAGES));
}

/** The billable ceiling: one call per query per page. */
export const maxCalls = (queries: number, pages: number) => queries * pages;

/** A news query biased toward the window. before: is exclusive, so it gets the day after `end`. */
export function newsQuery(query: string, start: string, end: string): string {
  if (!(start && end)) return query;
  return `${query} after:${start} before:${nextDay(end)}`;
}

/** Google's custom date range for tbs. */
export function tbs(start: string, end: string): string {
  const us = (d: string) => {
    const [y, m, day] = d.split("-");
    return `${m}/${day}/${y}`;
  };
  return `cdr:1,cd_min:${us(start)},cd_max:${us(end)}`;
}

/** Parameters for page 1 of a query, without the API key (added only when the request is sent). */
export function buildParams(query: string, start: string, end: string, vertical: Vertical, region: Region): Params {
  const market = { gl: REGIONS[region].gl, hl: REGIONS[region].hl };
  if (vertical === "news") return { engine: "google_news", q: newsQuery(query, start, end), ...market };
  const params: Params = { engine: "google", q: query, ...market };
  if (start && end) params.tbs = tbs(start, end);
  if (vertical === "news_tab") params.tbm = "nws";
  return params;
}

export function pageParams(base: Params, pageIndex: number): Params {
  return pageIndex ? { ...base, start: String(pageIndex * PAGE_SIZE) } : { ...base };
}

/** Results are under news_results for both news verticals. */
export const resultsKey = (vertical: Vertical) => (vertical === "web" ? "organic_results" : "news_results");

type Item = Record<string, unknown>;
const isItem = (v: unknown): v is Item => typeof v === "object" && v !== null && !Array.isArray(v);

/** google_news can return clusters (a highlight plus stories) instead of articles; replace each cluster by its
 * articles so none of the paid-for results is dropped for lacking a link of its own. */
export function flattenNews(results: unknown): Item[] {
  const out: Item[] = [];
  for (const item of Array.isArray(results) ? results : []) {
    if (!isItem(item)) continue;
    const nested: Item[] = [];
    if (isItem(item.highlight)) nested.push(item.highlight);
    if (Array.isArray(item.stories)) nested.push(...item.stories.filter(isItem));
    out.push(...(nested.length ? nested : [item]));
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** SerpAPI's source is a string on web and {name} on news. */
function outlet(source: unknown): string {
  if (isItem(source)) return str(source.name);
  return str(source);
}

/** The link's host without its first "www.". */
export function domainOf(link: string): string {
  try {
    return new URL(link).host.replace("www.", "");
  } catch {
    return "";
  }
}

/** One query's results as rows. Page and rank come from the position in the list (before rows without a link are
 * dropped, so ranks keep Google's order); news from google_news is always page 1. */
export function mapResults(
  results: Item[], query: string, vertical: Vertical, fetchedAt: string, start = "", end = "", now: Date = new Date(),
): SerpRow[] {
  const rows: SerpRow[] = [];
  results.forEach((res, i) => {
    const link = str(res.link);
    if (!link) return;
    const published = publishedDate(res, now);
    rows.push({
      query,
      vertical,
      provider: "serpapi",
      page: vertical === "news" ? 1 : Math.floor(i / PAGE_SIZE) + 1,
      rank: i + 1,
      title: str(res.title),
      link,
      domain: domainOf(link),
      date: str(res.date),
      published,
      out_of_range: rangeFlag(published, start, end),
      range_start: start,
      range_end: end,
      snippet: str(res.snippet),
      outlet: outlet(res.source),
      fetched_at: fetchedAt,
    });
  });
  return rows;
}

/** Pagination stops on an empty page, or on a short page that SerpAPI did not mark as having a next page. A short
 * page alone is not the end: Google gives organic slots to video and People-Also-Ask blocks mid-results. */
export function isLastPage(page: unknown[], data: Item): boolean {
  if (!page.length) return true;
  const next = isItem(data.serpapi_pagination) && !!data.serpapi_pagination.next;
  return page.length < PAGE_SIZE && !next;
}

/** One page from SerpAPI (or the cache). data null means the call itself failed. */
export type PageFetcher = (params: Params) => Promise<{ data: Item | null; cached: boolean; error?: string }>;

export interface QueryInput {
  query: string;
  start: string;
  end: string;
  pages: number;
  vertical: Vertical;
  region: Region;
}

export interface QueryOutcome {
  rows: SerpRow[];
  error: string;
  attempts: number;
  /** Billable calls actually sent (cache hits are free). */
  calls: number;
}

interface FetchOutcome { results: Item[]; error: string; calls: number }

async function fetchPages(
  base: Params, pages: number, vertical: Vertical, fetchPage: PageFetcher, deadline: number,
): Promise<FetchOutcome> {
  const collected: Item[] = [];
  let calls = 0;
  for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
    if (Date.now() > deadline) {
      return { results: collected, calls, error: `stopped at page ${pageIndex + 1} to stay inside the time limit` };
    }
    const { data, cached, error } = await fetchPage(pageParams(base, pageIndex));
    if (data === null) {
      return {
        results: collected,
        calls,
        error: `page ${pageIndex + 1} request failed${error ? ` (${error})` : " (SerpAPI call returned no data)"}`,
      };
    }
    // SerpAPI bills a search that came back, not one that errored, and a cache hit costs nothing.
    if (!cached) calls++;
    let page: unknown = data[resultsKey(vertical)];
    page = Array.isArray(page) ? page : [];
    const items = vertical === "news" ? flattenNews(page) : (page as unknown[]).filter(isItem);
    collected.push(...items);
    if (isLastPage(items, data)) break;
  }
  return { results: collected, calls, error: "" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One query, start to finish, with up to QUERY_ATTEMPTS attempts. Only a failed call is retried, never a query that
 * legitimately found nothing; a retry re-runs the query, and the pages that already succeeded come from the cache
 * at no cost. When every attempt fails, the rows of the attempt that got furthest are kept.
 */
export async function runQuery(
  input: QueryInput,
  fetchPage: PageFetcher,
  opts: { deadline?: number; now?: () => Date; backoffMs?: number } = {},
): Promise<QueryOutcome> {
  const deadline = opts.deadline ?? Number.POSITIVE_INFINITY;
  const now = opts.now ?? (() => new Date());
  const backoff = opts.backoffMs ?? RETRY_BACKOFF_MS;
  const pages = pagesFor(input.vertical, input.pages);
  const base = buildParams(input.query, input.start, input.end, input.vertical, input.region);
  let best: SerpRow[] = [];
  let error = "";
  let calls = 0;
  let attempt = 0;
  for (attempt = 1; attempt <= QUERY_ATTEMPTS; attempt++) {
    const fetchedAt = now().toISOString().replace(/\.\d{3}Z$/, "+00:00");
    const got = await fetchPages(base, pages, input.vertical, fetchPage, deadline);
    calls += got.calls;
    const rows = mapResults(got.results, input.query, input.vertical, fetchedAt, input.start, input.end, now());
    if (!got.error) return { rows, error: "", attempts: attempt, calls };
    error = got.error;
    if (rows.length > best.length) best = rows;
    const wait = backoff * 2 ** (attempt - 1);
    if (attempt === QUERY_ATTEMPTS || Date.now() + wait > deadline) break;
    await sleep(wait);
  }
  return { rows: best, error: attempt > 1 ? `${error} (after ${attempt} attempts)` : error, attempts: attempt, calls };
}

/** One spreadsheet row in EXPORT_COLUMNS order. Outside Range is blank when unknown, never "no". */
export function exportRow(r: SerpRow): (string | number)[] {
  return [
    r.query, r.vertical, r.provider, r.page, r.rank, r.date, r.published ?? "",
    r.out_of_range === null ? "" : r.out_of_range ? "yes" : "no",
    r.domain, r.outlet, r.title, r.snippet, r.link, r.fetched_at,
  ];
}
