import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

test("search runs live, lists results, exports, retries and deletes", async ({ page }, info) => {
  const first = `mokobara luggage ${info.project.name}`;
  await createRun(page, [first, "mokobara review", "fail: broken query"]);
  await expect(page.getByRole("heading", { name: first, level: 1 })).toBeVisible();
  const headerBox = await page.getByTestId("run-header").boundingBox();
  const progressBox = await page.getByTestId("search-progress").boundingBox();

  const progress = page.getByTestId("search-progress");
  await expect(progress).toContainText("Search finished");
  await expect(progress).toContainText("3 of 3 queries");
  await expect(progress).toContainText("1 failed");
  await expect(page.getByTestId("query-row-2")).toContainText("Failed");
  await expect(page.getByTestId("serp-total")).toHaveText("5");
  await expect(page.getByTestId("serp-row")).toHaveCount(5);

  // no layout shift between the first render and the finished state
  expect((await page.getByTestId("run-header").boundingBox())?.height).toBe(headerBox?.height);
  expect((await page.getByTestId("search-progress").boundingBox())?.height).toBe(progressBox?.height);

  await page.getByLabel("Search results").fill("article-3");
  await expect(page.getByTestId("serp-total")).toHaveText("1");
  await page.getByLabel("Search results").fill("");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download SERP xlsx" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/_serp\.xlsx$/);
  await shot(page, "run-search", info);

  const priorScrapeJobId = await progress.getAttribute("data-scrape-job-id");
  await page.getByRole("button", { name: "Retry failed queries" }).click();
  // retry-failed creates a new scrape job; wait for that transition instead of re-asserting text that was
  // already true before the click, which would pass immediately and race the still-in-flight retry job.
  await expect(progress).not.toHaveAttribute("data-scrape-job-id", priorScrapeJobId ?? "");
  await expect(progress).toHaveAttribute("data-active", "false");
  await expect(progress).toContainText("Search finished");
  await expect(page.getByTestId("query-row-2")).toContainText("Failed");

  const deleteButton = page.getByRole("button", { name: "Delete run" });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("http://localhost:3100/");
  await expect(page.getByRole("link", { name: first })).toHaveCount(0);
});
