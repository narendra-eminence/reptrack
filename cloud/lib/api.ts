import type { Page, Plan, ResultRow, Role, RunDetail, RunListItem, SearchInput, StepResult, UserRow } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

const DOWN = "The server could not be reached. Check your connection and try again.";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new ApiError(0, DOWN, null);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
    // Signed out in another tab, or the session expired: go to the login page and come back here afterwards.
    // A full page load on purpose: the server layout must re-render without the old session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  if (!res.ok) {
    const msg = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${res.status}).`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

const send = <T,>(method: string, path: string, data?: unknown) =>
  request<T>(path, { method, body: data === undefined ? undefined : JSON.stringify(data) });

const qs = (p: Record<string, string | number>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== "") s.set(k, String(v));
  return s.toString() ? `?${s}` : "";
};

export const api = {
  login: (email: string, password: string) => send<{ ok: true }>("POST", "/api/auth/login", { email, password }),
  logout: () => send<{ ok: true }>("POST", "/api/auth/logout"),
  changePassword: (current: string, next: string) => send<{ ok: true }>("POST", "/api/account/password", { current, next }),
  plan: (input: SearchInput) => send<Plan>("POST", "/api/plan", input),
  createRun: (input: SearchInput & { confirmed_calls: number }) => send<{ id: string }>("POST", "/api/runs", input),
  listRuns: () => request<RunListItem[]>("/api/runs"),
  getRun: (id: string) => request<RunDetail>(`/api/runs/${id}`),
  step: (id: string) => send<{ step: StepResult | null }>("POST", `/api/runs/${id}/step`),
  cancel: (id: string) => send<{ cancelled: string }>("POST", `/api/runs/${id}/cancel`),
  resume: (id: string, includeFailed = true) => send<{ requeued: number }>("POST", `/api/runs/${id}/resume`, { include_failed: includeFailed }),
  deleteRun: (id: string) => send<{ deleted: string }>("DELETE", `/api/runs/${id}`),
  rows: (id: string, p: { offset: number; limit: number; q?: string }) =>
    request<Page<ResultRow>>(`/api/runs/${id}/rows${qs({ offset: p.offset, limit: p.limit, q: p.q ?? "" })}`),
  users: () => request<UserRow[]>("/api/admin/users"),
  createUser: (email: string, password: string, role: Role) => send<UserRow>("POST", "/api/admin/users", { email, password, role }),
  updateUser: (id: string, patch: { role?: Role; password?: string }) => send<{ updated: string }>("PATCH", `/api/admin/users/${id}`, patch),
  deleteUser: (id: string) => send<{ deleted: string }>("DELETE", `/api/admin/users/${id}`),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
