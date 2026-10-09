import "server-only";
import { NextResponse } from "next/server";

/** An error a route reports to the browser as {"error": message, ...extra} with its HTTP status. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Run a route body; ApiError becomes its JSON error, anything else a logged 500 with no internals leaked. */
export async function handle(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    const out = await fn();
    return out instanceof NextResponse ? out : json(out);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message, ...e.extra }, e.status);
    console.error(e);
    return json({ error: "Something went wrong on the server. Try again; if it keeps happening, check the logs." }, 500);
  }
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "The request body is not valid JSON.");
  }
}

/** Fail with the Supabase error's message (a PostgrestError or AuthError), or return the data. */
export function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Like check, for reads that always return data (lists, .single(), inserts with .select()). */
export function need<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = check(res, what);
  if (data === null || data === undefined) throw new Error(`${what}: no data returned`);
  return data as NonNullable<T>;
}
