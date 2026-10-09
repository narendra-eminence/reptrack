import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";
import { ADMIN, fillSearch, fresh, progress, serpStats, signIn, startSearch, waitFinished } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, ADMIN);
});

test("a web search runs to the end, shows its results and exports the SERP xlsx", async ({ page }) => {
  const a = fresh("acme corp n23");
  const b = fresh("beta inc n5");
  const c = fresh("nothing here");
  await fillSearch(page, { queries: `${a}\n${b}\n\n${c}`, pages: 3, start: "2026-09-01", end: "2026-09-30" });
  await expect(page.getByTestId("plan-count")).toHaveText("3");
  await expect(page.getByTestId("plan-pages")).toHaveText("3");
  await expect(page.getByTestId("plan-max")).toHaveText("9");
  await expect(page.getByTestId("plan-cached")).toHaveText("0");
  await page.screenshot({ path: "test-results/screens/new-search.png", fullPage: true });
  await page.getByRole("button", { name: "Run search" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("up to 9 billable SerpAPI page requests");
  await page.getByRole("button", { name: "Confirm and run" }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);

  await waitFinished(page);
  // acme: pages of 10, 10 and 3; beta: one short page; nothing: one empty answer.
  await expect(progress(page)).toContainText("3 of 3 queries · 28 results · 5 billed pages of up to 9");
  await expect(page.getByTestId("query-row-0")).toContainText("Done");
  await expect(page.getByTestId("query-row-0").locator("td").nth(3)).toHaveText("23");
  await expect(page.getByTestId("query-row-1").locator("td").nth(3)).toHaveText("5");
  await expect(page.getByTestId("query-row-2").locator("td").nth(3)).toHaveText("0");
  // Dates in October (every fourth result) are outside the September window: 5 of acme's 23, 1 of beta's 5.
  await expect(page.getByTestId("query-row-0").locator("td").nth(4)).toHaveText("5");
  const stats = await serpStats();
  expect([a, b, c].map((q) => Object.entries(stats.byQuery).filter(([k]) => k.startsWith(q)).reduce((n, [, v]) => n + v, 0))).toEqual([3, 1, 1]);

  await expect(page.getByTestId("results-total")).toHaveText("28");
  await expect(page.getByTestId("result-row")).toHaveCount(28);
  await page.getByLabel("Filter results").fill("beta inc");
  await expect(page.getByTestId("results-total")).toHaveText("5");
  await page.getByLabel("Filter results").fill("");
  await expect(page.getByTestId("results-total")).toHaveText("28");
  await page.screenshot({ path: "test-results/screens/run-finished.png", fullPage: true });

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download SERP xlsx" }).click()]);
  const slug = a.replace(/[^A-Za-z0-9]+/g, "-");
  expect(download.suggestedFilename()).toBe(`${slug}_2026-09-01_2026-09-30_IN_serp.xlsx`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await download.path())!);
  const ws = wb.getWorksheet("Bulk Search")!;
  const header = (ws.getRow(1).values as unknown[]).slice(1);
  expect(header[0]).toBe("Query");
  expect(ws.rowCount).toBe(29);
  const col = (name: string) => header.indexOf(name) + 1;
  const outside = Array.from({ length: 28 }, (_, i) => ws.getRow(i + 2).getCell(col("Outside Range")).value);
  expect(outside.filter((v) => v === "yes")).toHaveLength(6);
  expect(outside.filter((v) => v === "no")).toHaveLength(22);
  expect(ws.getRow(2).getCell(col("Query")).value).toBe(a);

  // The run is in everyone's history.
  await page.getByRole("link", { name: "Runs" }).click();
  const row = page.getByTestId("run-row").filter({ hasText: a });
  await expect(row).toContainText("Finished");
  await expect(row).toContainText("28");
  await expect(row).toContainText(ADMIN.email);
  await page.screenshot({ path: "test-results/screens/runs.png", fullPage: true });
});

test("repeating a search within 30 days is served from the cache for free", async ({ page }) => {
  const q = fresh("cached co n12");
  await fillSearch(page, { queries: q, pages: 2 });
  await startSearch(page);
  await waitFinished(page);
  await expect(progress(page)).toContainText("2 billed pages of up to 2");
  const before = (await serpStats()).calls;

  await fillSearch(page, { queries: q, pages: 2 });
  await expect(page.getByTestId("plan-cached")).toHaveText("2");
  await startSearch(page);
  await waitFinished(page);
  await expect(progress(page)).toContainText("12 results · 0 billed pages of up to 2");
  expect((await serpStats()).calls).toBe(before);
});

test("news searches once per query and unpacks story clusters", async ({ page }) => {
  const q = fresh("gamma news");
  await fillSearch(page, { queries: q, vertical: "News", start: "2026-09-01", end: "2026-09-30" });
  await expect(page.getByLabel("Pages per query")).toBeDisabled();
  await expect(page.getByLabel("Pages per query")).toHaveValue("1");
  await expect(page.getByTestId("plan-max")).toHaveText("1");
  await startSearch(page);
  await waitFinished(page);
  await expect(progress(page)).toContainText("1 of 1 queries · 4 results · 1 billed pages");
  await expect(page.getByTestId("result-row").filter({ hasText: `${q} result 3` })).toHaveCount(1);
  const stats = await serpStats();
  expect(Object.keys(stats.byQuery).find((k) => k.startsWith(q))).toBe(`${q} after:2026-09-01 before:2026-10-01`);
});

test("the form explains what is wrong before anything is spent", async ({ page }) => {
  await fillSearch(page, { queries: "acme", start: "2026-09-10" });
  await expect(page.locator("main").getByRole("alert")).toHaveText("Start and end dates go together: fill both or leave both empty.");
  await expect(page.getByRole("button", { name: "Run search" })).toBeDisabled();
  await page.getByLabel("End date").fill("2026-09-01");
  await expect(page.locator("main").getByRole("alert")).toHaveText("Start date 2026-09-10 is after end date 2026-09-01.");
  await page.getByLabel("End date").fill("2026-09-30");
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run search" })).toBeEnabled();
  // A confirmation that does not match the cost is refused by the server.
  const res = await page.request.post("/api/runs", {
    data: { queries: "acme", vertical: "web", region: "in", pages: 5, start: "", end: "", confirmed_calls: 1 },
  });
  expect(res.status()).toBe(409);
  expect((await res.json()).max_calls).toBe(5);
});
