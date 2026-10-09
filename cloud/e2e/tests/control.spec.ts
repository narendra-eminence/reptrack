import { expect, test } from "@playwright/test";
import { ADMIN, createMember, fillSearch, fresh, newSession, progress, serpControl, serpStats, signIn, startSearch, waitFinished } from "./helpers";

test.beforeEach(async ({ page }) => {
  await serpControl({ flaky: false });
  await signIn(page, ADMIN);
});

const slowQueries = (n: number) => Array.from({ length: n }, (_, i) => fresh(`slow q${i} n12`)).join("\n");

test("Stop pauses a run after the queries in flight; Resume finishes it", async ({ page }) => {
  await fillSearch(page, { queries: slowQueries(6), pages: 2 });
  await startSearch(page);
  await expect(progress(page).getByText("Searching in this tab")).toBeVisible();
  await page.screenshot({ path: "test-results/screens/run-searching.png", fullPage: true });
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(progress(page).getByText("Stopped", { exact: true })).toBeVisible({ timeout: 30_000 });
  // The 4 queries already being searched finish and are kept; the other 2 wait.
  await expect(progress(page)).toContainText("4 of 6 queries");
  await expect(page.getByText(/Paused\. Resume continues/)).toBeVisible();
  await page.screenshot({ path: "test-results/screens/run-stopped.png", fullPage: true });
  await page.getByRole("button", { name: "Resume" }).click();
  await waitFinished(page);
  await expect(progress(page)).toContainText("6 of 6 queries · 72 results · 12 billed pages");
});

test("a failing query can be retried once the cause is gone", async ({ page }) => {
  await serpControl({ flaky: true });
  const ok = fresh("steady n3");
  const bad = fresh("flaky n3");
  await fillSearch(page, { queries: `${ok}\n${bad}` });
  await startSearch(page);
  await waitFinished(page, "Finished with failed queries");
  await expect(page.getByTestId("query-row-1")).toContainText("Failed");
  await expect(page.getByTestId("query-row-1")).toContainText("HTTP 500: Internal error (fake)");
  await expect(page.getByTestId("query-row-1")).toContainText("(after 3 attempts)");
  await expect(progress(page)).toContainText("1 billed pages of up to 2"); // SerpAPI does not bill errors
  await expect(page.getByText("e2e-key")).toHaveCount(0); // the key never reaches the browser
  await page.screenshot({ path: "test-results/screens/run-failed.png", fullPage: true });
  await serpControl({ flaky: false });
  await page.getByRole("button", { name: "Retry failed queries" }).click();
  await waitFinished(page);
  await expect(page.getByTestId("query-row-1")).toContainText("Done");
  await expect(progress(page)).toContainText("2 of 2 queries · 6 results");
});

test("reloading mid-run loses nothing and carries on", async ({ page }) => {
  const queries = slowQueries(6);
  await fillSearch(page, { queries });
  await startSearch(page);
  await expect(progress(page).getByText("Searching in this tab")).toBeVisible();
  page.on("dialog", (d) => void d.accept()); // the "leave site?" prompt
  await page.reload();
  // The steps started before the reload keep running on the server; this tab watches them, then takes over.
  await waitFinished(page);
  await expect(progress(page)).toContainText("6 of 6 queries · 60 results · 6 billed pages");
  const stats = await serpStats();
  for (const q of queries.split("\n")) expect(stats.byQuery[q]).toBe(1); // nothing searched twice
});

test("a second window shows the search live without searching anything twice", async ({ page, browser }) => {
  const queries = slowQueries(8);
  await fillSearch(page, { queries });
  const id = await startSearch(page);
  await expect(progress(page).getByText("Searching in this tab")).toBeVisible();
  const other = await newSession(browser, ADMIN, `/runs/${id}`);
  await expect(progress(other.page).getByText("Searching in another tab or window")).toBeVisible();
  await expect(other.page.getByRole("button", { name: "Resume" })).toHaveCount(0);
  await waitFinished(other.page);
  await waitFinished(page);
  const stats = await serpStats();
  for (const q of queries.split("\n")) expect(stats.byQuery[q]).toBe(1);
  await other.context.close();
});

test("only the person who started a run, or an admin, can delete it", async ({ page, browser }) => {
  const q = fresh("delete me n2");
  await fillSearch(page, { queries: q });
  const id = await startSearch(page);
  await waitFinished(page);

  const member = { email: `m${Date.now()}@e2e.test`, password: "member-password-1" };
  await createMember(member.email, member.password);
  const m = await newSession(browser, member, `/runs/${id}`);
  await expect(m.page.getByRole("heading", { name: q })).toBeVisible();
  await expect(m.page.getByRole("button", { name: "Delete run" })).toHaveCount(0);
  expect((await m.page.request.delete(`/api/runs/${id}`)).status()).toBe(403);
  await m.context.close();

  await page.getByRole("button", { name: "Delete run" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Its queries and 2 results are removed for everyone.");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/localhost:3200\/$/);
  await expect(page.getByTestId("run-row").filter({ hasText: q })).toHaveCount(0);
  expect((await page.request.get(`/api/runs/${id}`)).status()).toBe(404);
  const missing = await page.goto(`/runs/${id}`);
  expect(missing?.status()).toBe(200);
  await expect(page.locator("main").getByRole("alert")).toContainText("No such run");
});
