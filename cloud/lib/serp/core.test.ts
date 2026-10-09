import { describe, expect, it } from "vitest";
import golden from "./__fixtures__/golden.json";
import {
  EXPORT_COLUMNS, buildParams, exportRow, flattenNews, isLastPage, mapResults, maxCalls, newsQuery, pageParams,
  pagesFor, parseQueries, runQuery, tbs, type PageFetcher, type Params, type Region, type SerpRow, type Vertical,
} from "./core";
import { isIsoDate, parsePubDate, rangeFlag } from "./dates";

// golden.json is Company Monitor's own output for these inputs (scripts/golden_from_company_monitor.py), with
// "now" fixed at this instant for relative dates.
const NOW = new Date("2026-09-15T10:30:00Z");

describe("matches Company Monitor's bulk_search", () => {
  it.each(golden.parse_pub_date as [string, string | null][])("parse_pub_date(%j)", (raw, want) => {
    expect(parsePubDate(raw, NOW)).toBe(want);
  });

  it.each(golden.parse_queries as [string, string[]][])("parse_queries(%j)", (raw, want) => {
    expect(parseQueries(raw)).toEqual(want);
  });

  it.each(golden.news_query as [string, string, string, string][])("news_query(%j, %j, %j)", (q, s, e, want) => {
    expect(newsQuery(q, s, e)).toBe(want);
  });

  it.each(golden.pages_for as [Vertical, unknown, number][])("pages_for(%j, %j)", (v, p, want) => {
    expect(pagesFor(v, p)).toBe(want);
  });

  it.each(golden.build_params as [[string, string, string, Vertical, Region], Params][])("build_params(%j)", (args, want) => {
    // The key is added when a request is sent, never stored or cached.
    const rest = Object.fromEntries(Object.entries(want).filter(([k]) => k !== "api_key"));
    expect(buildParams(...args)).toEqual(rest);
  });

  it("page params and tbs", () => {
    // Python keeps `start` as an int; here every param is a string because it only ever goes into a URL.
    const asUrl = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]));
    expect([pageParams({ q: "a" }, 0), pageParams({ q: "a" }, 3)]).toEqual(golden.page_params.map(asUrl));
    expect(tbs("2026-09-01", "2026-09-30")).toBe(golden.tbs);
  });

  it("flattens google_news clusters", () => {
    const [input, want] = golden.flatten_news;
    expect(flattenNews(input)).toEqual(want);
  });

  it.each(golden.is_last_page as [number, boolean, boolean][])("is_last_page(%i results, next=%j)", (n, next, want) => {
    expect(isLastPage(Array(n).fill({}), { serpapi_pagination: next ? { next: "u" } : {} })).toBe(want);
  });

  const asRow = (r: Record<string, unknown>) => ({ ...r, published: r.published || null, range_start: r.range_start, range_end: r.range_end });

  it("maps web results", () => {
    const got = mapResults(golden.map_results.input, "acme", "web", "2026-09-15T10:30:00+00:00", "2026-09-01", "2026-09-30", NOW);
    expect(got).toEqual(golden.map_results.web.map(asRow));
  });

  it("maps news results on page 1", () => {
    const got = mapResults(golden.map_results.input, "acme", "news", "2026-09-15T10:30:00+00:00", "", "", NOW);
    expect(got).toEqual(golden.map_results.news.map(asRow));
  });

  it("exports the same columns and cells", () => {
    const [cols, rows, input] = golden.export as [string[], (string | number)[][], Record<string, unknown>[]];
    expect([...EXPORT_COLUMNS]).toEqual(cols);
    expect(input.map((r) => exportRow(asRow(r) as unknown as SerpRow))).toEqual(rows);
  });
});

describe("dates and limits", () => {
  it("range flag is tri-state", () => {
    expect(rangeFlag("2026-09-01", "2026-09-01", "2026-09-30")).toBe(false);
    expect(rangeFlag("2026-10-01", "2026-09-01", "2026-09-30")).toBe(true);
    expect(rangeFlag(null, "2026-09-01", "2026-09-30")).toBeNull();
    expect(rangeFlag("2026-09-05", "", "")).toBeNull();
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    for (const bad of ["2026-02-30", "20260301", "2026-W10-1", "", "2026-1-1"]) expect(isIsoDate(bad)).toBe(false);
  });

  it("caps pages and counts calls", () => {
    expect(pagesFor("web", 500)).toBe(50);
    expect(maxCalls(12, 3)).toBe(36);
  });
});

function fakeFetcher(pages: Record<string, Record<string, unknown> | null>, cachedStarts: string[] = []) {
  const calls: Params[] = [];
  const fetchPage: PageFetcher = async (params) => {
    calls.push(params);
    const start = params.start ?? "0";
    const data = pages[start];
    return { data: data === undefined ? { organic_results: [] } : data, cached: cachedStarts.includes(start) };
  };
  return { fetchPage, calls };
}

const items = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ title: `t${from + i}`, link: `https://x.com/${from + i}` }));
const input = { query: "acme", start: "", end: "", pages: 5, vertical: "web" as const, region: "in" as const };

describe("runQuery", () => {
  it("follows pages until a short page without a next link, and counts only uncached calls", async () => {
    const { fetchPage, calls } = fakeFetcher(
      {
        "0": { organic_results: items(9), serpapi_pagination: { next: "u" } }, // short but advertised next: continue
        "10": { organic_results: items(10, 9) },
        "20": { organic_results: items(4, 19) }, // short and no next: stop
      },
      ["0"],
    );
    const out = await runQuery(input, fetchPage, { now: () => NOW });
    expect(calls.map((c) => c.start ?? "0")).toEqual(["0", "10", "20"]);
    expect(out).toMatchObject({ error: "", attempts: 1, calls: 2 });
    expect(out.rows.map((r) => r.rank)).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    expect(out.rows[22].page).toBe(3);
  });

  it("never fetches more than the page budget", async () => {
    const { fetchPage, calls } = fakeFetcher({ "0": { organic_results: items(10) }, "10": { organic_results: items(10, 10) } });
    await runQuery({ ...input, pages: 2 }, fetchPage);
    expect(calls).toHaveLength(2);
  });

  it("retries a failed call and keeps the attempt that got furthest", async () => {
    const { fetchPage, calls } = fakeFetcher({ "0": { organic_results: items(10) }, "10": null });
    const out = await runQuery({ ...input, pages: 2 }, fetchPage, { backoffMs: 1 });
    expect(calls).toHaveLength(6);
    expect(out.attempts).toBe(3);
    expect(out.rows).toHaveLength(10);
    expect(out.error).toBe("page 2 request failed (SerpAPI call returned no data) (after 3 attempts)");
    expect(out.calls).toBe(3); // page 1 on each attempt; the failed page 2 calls are not billed
  });

  it("does not retry a query that found nothing", async () => {
    const { fetchPage, calls } = fakeFetcher({ "0": { organic_results: [] } });
    const out = await runQuery(input, fetchPage);
    expect(calls).toHaveLength(1);
    expect(out).toMatchObject({ rows: [], error: "", attempts: 1 });
  });

  it("stops before the deadline instead of being killed mid-call", async () => {
    const { fetchPage, calls } = fakeFetcher({ "0": { organic_results: items(10) } });
    const out = await runQuery(input, fetchPage, { deadline: Date.now() - 1 });
    expect(calls).toHaveLength(0);
    expect(out.error).toMatch(/time limit/);
    expect(out.attempts).toBe(1);
  });

  it("news is one call with the window in the query", async () => {
    const { fetchPage, calls } = fakeFetcher({ "0": { news_results: [{ highlight: { title: "h", link: "https://h.com", iso_date: "2026-09-02T00:00:00Z" } }] } });
    const out = await runQuery({ ...input, vertical: "news", pages: 9, start: "2026-09-01", end: "2026-09-30" }, fetchPage);
    expect(calls).toEqual([{ engine: "google_news", q: "acme after:2026-09-01 before:2026-10-01", gl: "in", hl: "en" }]);
    expect(out.rows[0]).toMatchObject({ page: 1, published: "2026-09-02", out_of_range: false });
  });
});
