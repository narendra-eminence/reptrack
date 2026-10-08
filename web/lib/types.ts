export type Provider = "serpapi" | "dataforseo";
export type Vertical = "web" | "news" | "news_tab";
export type RunStatus = "scraping" | "scraped" | "verifying" | "verified" | "failed";
export type JobState = "queued" | "running" | "cancelling" | "done" | "failed" | "cancelled";
export type Cell = string | number | boolean | null;

export interface Options { providers: Provider[]; verticals: Vertical[]; max_pages: Record<Provider, number> }
export interface Health {
  ok: boolean;
  company_monitor: boolean;
  url_verification: boolean;
  verifier_config_error: string | null;
  keys: Record<Provider, string | null>;
  chromium: boolean;
  suggest_available: boolean;
}
export interface SearchInput { queries: string; provider: Provider; vertical: Vertical; pages: string; start: string; end: string }
export interface Plan { queries: string[]; count: number; pages: number; max_calls: number; cached_calls: number }
export interface QueryRow {
  id: number;
  position: number;
  text: string;
  state: "pending" | "done" | "failed";
  found: number | null;
  out_of_range: number | null;
  attempts: number | null;
  error: string | null;
}
export interface Job {
  id: number;
  kind: "scrape" | "verify";
  run_id: string;
  ref_id: number | null;
  state: JobState;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  resumed_at: string | null;
}
export interface BrandRule {
  name: string;
  pattern: string;
  require_context: string[];
  exclude: string[];
  case_sensitive: boolean;
  context_window: number;
}
export interface BrandSet { name: string; rules: BrandRule[]; managed: boolean; stale: boolean }
export type Closeness = "close" | "nearby" | "paragraph";
export interface EverydayWord {
  word: string;
  exact_case: boolean;
  closeness: Closeness;
  confirm: string[];
  not_followed_by: string[];
  not_preceded_by: string[];
  not_in_sentence_with: string[];
  ignore_phrases: string[];
}
export interface ProfileBrand { name: string; always: string[]; handles: string[]; everyday_word: EverydayWord | null }
export interface Person { name: string; common: boolean }
export interface BrandProfile { brands: ProfileBrand[]; people: Person[] }
export interface ProfileWarning { brand: number | null; field: string; message: string }
export interface Suggestion {
  always: string[];
  handles: string[];
  everyday_word: EverydayWord | null;
  people: Person[];
  notes: string;
}
export interface VerifyJob {
  id: number;
  brand_set: string;
  brand_rules: BrandRule[];
  status: JobState;
  total_urls: number | null;
  done_urls: number;
  status_counts: Record<string, number>;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  has_output: boolean;
}
export interface RunCounts { queries: number; done: number; failed: number; pending: number; serp_rows: number }
export interface RunDetail {
  id: string;
  name: string;
  provider: Provider;
  vertical: Vertical;
  pages: number;
  start_date: string | null;
  end_date: string | null;
  status: RunStatus;
  max_calls: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  counts: RunCounts;
  queries: QueryRow[];
  verify_jobs: VerifyJob[];
  active_job: Job | null;
  last_job: Job | null;
  last_scrape_job: Job | null;
}
export interface RunListItem {
  id: string;
  name: string;
  provider: Provider;
  vertical: Vertical;
  start_date: string | null;
  end_date: string | null;
  status: RunStatus;
  updated_at: string;
  serp_rows: number;
  verified: number | null;
}
export interface Page<T> { total: number; offset: number; limit: number; rows: T[] }
export type SerpRow = Record<string, Cell>;
export interface VerifyRow { seq: number; status: string | null; is_duplicate: boolean; row: Record<string, Cell> }
export interface TryResult {
  hits: { brand: string; offset: number; snippet: string; text: string; before: string; after: string;
    cut_before: boolean; cut_after: boolean }[];
  excluded: {
    brand: string; offset: number; text: string; reason: string; snippet: string; before: string; after: string;
    cut_before: boolean; cut_after: boolean;
  }[];
}
export type RunEvent =
  | { type: "snapshot"; run: RunDetail }
  | {
      type: "query";
      query_id: number;
      position: number;
      state: QueryRow["state"];
      found: number;
      out_of_range: number;
      attempts: number;
      error: string | null;
      done: number;
      failed: number;
      total: number;
      rows: number;
    }
  | { type: "verify_progress"; verify_job_id: number; done_urls: number; total_urls: number; status_counts: Record<string, number> }
  | { type: "job"; job_id: number; kind: Job["kind"]; state: JobState; error: string | null }
  | { type: "resync" };
