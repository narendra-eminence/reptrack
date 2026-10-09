import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PageFetcher, Params } from "@/lib/serp/core";
import { ApiError } from "./http";

export const CACHE_DAYS = 30;
const HTTP_ATTEMPTS = 2; // per page, for timeouts, connection errors and 429s; the query is retried above this
const TIMEOUT_MS = 25_000;
const SERPAPI_URL = "https://serpapi.com/search";

/** SERPAPI_BASE_URL exists so tests can point at a fake; production always talks to serpapi.com. */
const endpoint = () => process.env.SERPAPI_BASE_URL || SERPAPI_URL;

export function apiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new ApiError(503, "SERPAPI_KEY is not set on the server. Add it in the Vercel project settings.");
  return key;
}

/** Cache key of one page request. The API key is not part of it, so rotating the key keeps the cache. */
export function cacheKey(params: Params): string {
  const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return createHash("sha256").update(`${SERPAPI_URL}?${JSON.stringify(sorted)}`).digest("hex");
}

const cutoff = () => new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();

/** How many of these page requests would be free (cached and fresh). */
export async function countCached(db: SupabaseClient, keys: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < keys.length; i += 300) {
    const { count, error } = await db
      .from("serp_cache")
      .select("key", { count: "exact", head: true })
      .in("key", keys.slice(i, i + 300))
      .gte("created_at", cutoff());
    if (error) throw new Error(`cache lookup: ${error.message}`);
    n += count ?? 0;
  }
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 30_000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.min(Math.max(at - Date.now(), 0), 30_000);
}

/** One SerpAPI page over HTTP: null data when the call failed, with the reason. */
async function fetchFromSerpApi(params: Params, key: string): Promise<{ data: Record<string, unknown> | null; error?: string }> {
  const url = `${endpoint()}?${new URLSearchParams({ ...params, api_key: key })}`;
  let error = "";
  for (let attempt = 0; attempt < HTTP_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    } catch (e) {
      error = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "connection failed";
      if (attempt < HTTP_ATTEMPTS - 1) await sleep(1000 * 2 ** attempt + Math.random() * 1000);
      continue;
    }
    if (res.status === 429) {
      error = "rate limited by SerpAPI";
      if (attempt < HTTP_ATTEMPTS - 1) await sleep(retryAfterMs(res.headers.get("retry-after")) ?? 1000 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      // SerpAPI explains failures (bad key, out of credits) in a JSON body; never echo the URL, which has the key.
      let detail = text.slice(0, 200);
      try {
        detail = String((JSON.parse(text) as { error?: unknown }).error ?? detail);
      } catch {}
      return { data: null, error: `HTTP ${res.status}: ${detail}` };
    }
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      if (typeof data.error === "string" && !Array.isArray(data.organic_results) && !Array.isArray(data.news_results)) {
        // SerpAPI answers 200 with {"error": "Google hasn't returned any results for this query."} for an empty
        // search; that is a real, empty answer, not a failure.
        if (/hasn't returned any results/i.test(data.error)) return { data: { ...data, organic_results: [], news_results: [] } };
        return { data: null, error: data.error };
      }
      return { data };
    } catch {
      return { data: null, error: "SerpAPI returned something that is not JSON" };
    }
  }
  return { data: null, error };
}

/** A PageFetcher that serves fresh cached pages for free and stores every successful new page. */
export function serpApiFetcher(db: SupabaseClient): PageFetcher {
  const key = apiKey();
  return async (params) => {
    const k = cacheKey(params);
    const { data: hit } = await db.from("serp_cache").select("response").eq("key", k).gte("created_at", cutoff()).maybeSingle();
    if (hit) return { data: hit.response as Record<string, unknown>, cached: true };
    const got = await fetchFromSerpApi(params, key);
    if (got.data) {
      const { error } = await db
        .from("serp_cache")
        .upsert({ key: k, response: got.data, created_at: new Date().toISOString() });
      if (error) console.error(`serp_cache write failed: ${error.message}`); // the page is still used
    }
    return { data: got.data, cached: false, error: got.error };
  };
}
