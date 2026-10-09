export type Provider = "serpapi" | "dataforseo";
export type Vertical = "web" | "news" | "news_tab";
export type Region = "in" | "us";
export type RunStatus = "scraping" | "scraped" | "verifying" | "verified" | "failed";
export type JobState = "queued" | "running" | "cancelling" | "done" | "failed" | "cancelled";
export type Cell = string | number | boolean | null;

export interface Options {
  providers: Provider[];
  verticals: Vertical[];
  max_pages: Record<Provider, number>;
  regions: { id: Region; label: string }[];
}
export interface Health {
  ok: boolean;
  company_monitor: boolean;
  url_verification: boolean;
  verifier_config_error: string | null;
  keys: Record<Provider, string | null>;
  chromium: boolean;
}
export interface SearchInput { queries: string; provider: Provider; region: Region; vertical: Vertical; pages: string; start: string; end: string }
export interface Plan { queries: string[]; count: number; pages: number; max_calls: number; cached_calls: number; region: Region | null }
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
  kind: "scrape" | "verify" | "clean";
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
export interface BrandSet {
  name: string;
  rules: BrandRule[];
  managed: boolean;
  stale: boolean;
  profile: BrandProfile | null;
  /** Saved with the set in config.yaml; `saved: false` holds suggestions (the form's social handles) or nothing. */
  cleaning: { details: CleaningDetails; saved: boolean };
}
export interface Exclusions { followed_by: string[]; preceded_by: string[]; nearby: string[]; phrases: string[] }
export interface Person { name: string; require_brand_nearby: boolean }
export interface TestSentence { text: string; expect: "match" | "no_match" }
export interface ProfileBrand {
  name: string;
  description: string;
  aliases: string[];
  hashtags: string[];
  handles: string[];
  common_word: boolean;
  confirming_words: string[];
  exclusions: Exclusions;
  people: Person[];
  tests: TestSentence[];
}
export interface BrandProfile { brands: ProfileBrand[] }
export interface ProfileWarning { brand: number | null; field: string; message: string }
export interface TryEntry {
  brand: string;
  offset: number;
  text: string;
  before: string;
  after: string;
  cut_before: boolean;
  cut_after: boolean;
  snippet: string;
  reason?: string;
  owner?: number | null; // elsewhere entries: index of the brand the mention belongs to
}
export interface TestResult {
  brand: number;
  index: number;
  text: string;
  expect: TestSentence["expect"];
  passed: boolean;
  counted: TryEntry[];
  not_counted: TryEntry[];
  elsewhere: TryEntry[];
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
export interface CleaningDetails {
  own_websites: string[];
  own_handles: string[];
  competitor_websites: string[];
  competitor_handles: string[];
}
export interface CleaningDetailsResponse { brand_set: string; details: CleaningDetails; saved: boolean; backup?: string }
/** What a finished cleaning reports; empty ({}) until it has finished. */
export interface CleanSummary {
  rows_in: number;
  unique_links: number;
  clean_data: number;
  brand_communication: number;
  competitor_owned: number;
  duplicates_link: number;
  duplicates_text: number;
  core_saved: number;
  new_domains: number;
  needs_review: number;
  buckets: Record<string, number>;
  sheets: Record<string, number>;
  checks_ok: boolean;
}
export interface CleanJob {
  id: number;
  verify_job_id: number;
  brand_set: string;
  details: CleaningDetails;
  status: JobState;
  summary: Partial<CleanSummary>;
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
  region: Region | null; // null: a run from before regions existed, searched on the provider's default market
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
  clean_jobs: CleanJob[];
  active_job: Job | null;
  last_job: Job | null;
  last_scrape_job: Job | null;
}
export interface RunListItem {
  id: string;
  name: string;
  provider: Provider;
  region: Region | null;
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
