import { createClient } from "@supabase/supabase-js";
import { expect, type Browser, type Page } from "@playwright/test";

export const ADMIN = { email: "admin@e2e.test", password: "admin-password-1" };
export const SERP = "http://127.0.0.1:4010";

export function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A query no earlier test has searched, so the cache does not answer it. */
export const fresh = (text: string) => `${text} t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

export async function signIn(page: Page, who: { email: string; password: string }, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("account-link")).toHaveText(who.email);
}

/** A second, independent browser session (its own cookies). */
export async function newSession(browser: Browser, who: { email: string; password: string }, next = "/") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signIn(page, who, next);
  return { context, page };
}

export async function serpStats(): Promise<{ calls: number; byQuery: Record<string, number> }> {
  return (await fetch(`${SERP}/stats`)).json();
}

export async function serpControl(body: { flaky?: boolean }) {
  await fetch(`${SERP}/control`, { method: "POST", body: JSON.stringify(body) });
}

export async function createMember(email: string, password: string, role: "member" | "admin" = "member") {
  const db = serviceClient();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  if (role === "admin") await db.from("profiles").update({ role }).eq("id", data.user.id);
  return data.user.id;
}

export interface SearchSpec {
  queries: string;
  vertical?: "Web" | "News" | "News tab";
  region?: "India" | "United States";
  pages?: number;
  start?: string;
  end?: string;
}

/** Fill the New search form and wait for its plan. */
export async function fillSearch(page: Page, s: SearchSpec) {
  await page.goto("/runs/new");
  await page.getByLabel("Queries").fill(s.queries);
  if (s.region) await page.getByLabel("Region").selectOption({ label: s.region });
  if (s.vertical) await page.getByLabel("Vertical").selectOption({ label: s.vertical });
  if (s.pages && s.vertical !== "News") await page.getByLabel("Pages per query").fill(String(s.pages));
  if (s.start) await page.getByLabel("Start date").fill(s.start);
  if (s.end) await page.getByLabel("End date").fill(s.end);
}

/** Start the filled-in search and land on its run page. Returns the run id. */
export async function startSearch(page: Page): Promise<string> {
  await expect(page.getByRole("button", { name: "Run search" })).toBeEnabled();
  await page.getByRole("button", { name: "Run search" }).click();
  await page.getByRole("button", { name: "Confirm and run" }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

export const progress = (page: Page) => page.getByTestId("search-progress");

export async function waitFinished(page: Page, label = "Finished") {
  await expect(progress(page).getByText(label, { exact: true })).toBeVisible({ timeout: 90_000 });
}
