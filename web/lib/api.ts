import type {
  BrandProfile, BrandSet, Health, Options, Page, Plan, ProfileWarning, RunDetail, RunListItem, SearchInput,
  SerpRow, TestResult, VerifyRow,
} from "./types";

const DOWN = "Backend not reachable. Start it with `make dev` in the repscore-pipeline folder.";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new ApiError(0, DOWN, null);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const fromBody = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
    throw new ApiError(res.status, fromBody ?? (res.status >= 502 ? DOWN : `Request failed (${res.status}).`), body);
  }
  return body as T;
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export const api = {
  health: () => request<Health>("/api/health"),
  options: () => request<Options>("/api/options"),
  plan: (input: SearchInput) => post<Plan>("/api/plan", input),
  createRun: (input: SearchInput & { confirmed_calls: number }) => post<{ id: string }>("/api/runs", input),
  listRuns: () => request<RunListItem[]>("/api/runs"),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  serpRows: (id: string, p: { offset: number; limit: number; q: string }) =>
    request<Page<SerpRow>>(`/api/runs/${id}/rows${qs(p)}`),
  retryFailed: (id: string) => post<{ job_id: number }>(`/api/runs/${id}/retry-failed`),
  deleteRun: (id: string) => request<{ deleted: string }>(`/api/runs/${id}`, { method: "DELETE" }),
  cancelJob: (jobId: number) => post<{ state: string }>(`/api/jobs/${jobId}/cancel`),
  retryJob: (jobId: number) => post<{ state: string }>(`/api/jobs/${jobId}/retry`),
  startVerify: (id: string, brandSet: string) =>
    post<{ verify_job_id: number; job_id: number }>(`/api/runs/${id}/verify`, { brand_set: brandSet }),
  verifyRows: (id: string, vj: number, p: { offset: number; limit: number; status?: string; hide_duplicates?: boolean; q?: string }) =>
    request<Page<VerifyRow>>(`/api/runs/${id}/verify/${vj}/results${qs(p)}`),
  brands: () => request<{ sets: BrandSet[] }>("/api/brands"),
  deleteBrand: (name: string) =>
    request<{ deleted: string; backup: string }>(`/api/brands/${encodeURIComponent(name)}`, { method: "DELETE" }),
  saveBrandProfile: (name: string, profile: BrandProfile, create = false) =>
    request<{ name: string; backup: string; warnings: ProfileWarning[]; tests: TestResult[] }>(
      `/api/brand-profiles/${encodeURIComponent(name)}`,
      { method: "PUT", body: JSON.stringify({ profile, create }) },
    ),
  checkBrandProfile: (profile: BrandProfile) =>
    post<{ warnings: ProfileWarning[]; tests: TestResult[] }>("/api/brand-profiles/check", { profile }),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
