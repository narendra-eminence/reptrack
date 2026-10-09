import type { Region, Vertical } from "@/lib/serp/core";

export type { Region, Vertical };
export type RunStatus = "pending" | "running" | "done" | "cancelled";
export type QueryState = "pending" | "running" | "done" | "failed";
export type Role = "admin" | "member";

export interface SearchInput {
  queries: string;
  region: Region;
  vertical: Vertical;
  pages: string;
  start: string;
  end: string;
}

export interface Plan {
  queries: string[];
  count: number;
  pages: number;
  max_calls: number;
  cached_calls: number;
}

interface RunCounts {
  query_count: number;
  done_count: number;
  failed_count: number;
  pending_count: number;
  running_count: number;
  row_count: number;
  calls_used: number;
}

export interface RunListItem extends RunCounts {
  id: string;
  name: string;
  vertical: Vertical;
  region: Region;
  pages: number;
  start_date: string | null;
  end_date: string | null;
  status: RunStatus;
  created_by_email: string;
  created_at: string;
  updated_at: string;
}

export interface QueryRow {
  id: number;
  position: number;
  text: string;
  state: QueryState;
  found: number | null;
  out_of_range: number | null;
  attempts: number | null;
  calls: number | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface RunDetail extends RunListItem {
  max_calls: number;
  created_by: string | null;
  out_of_range_count: number;
  queries: QueryRow[];
  /** Server time when this was read; compare query timestamps against it, not the browser clock. */
  now: string;
}

export interface ResultRow {
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
  range_start: string | null;
  range_end: string | null;
  snippet: string;
  outlet: string;
  fetched_at: string;
}

export interface Page<T> {
  total: number;
  offset: number;
  limit: number;
  rows: T[];
}

export interface StepResult {
  query_id: number;
  position: number;
  found: number;
  error: string;
  calls: number;
}

export interface UserRow {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface Me {
  id: string;
  email: string;
  role: Role;
}
