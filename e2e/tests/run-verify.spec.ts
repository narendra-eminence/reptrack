import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

test("verifies results with a chosen brand set, cleans them and exports", async ({ page }, info) => {
  await createRun(page, [`mokobara luggage v-${info.project.name}`, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);

  const start = page.getByRole("button", { name: "Start verification" });
  await expect(start).toBeDisabled();
  await page.getByLabel("Brand set").selectOption("mokobara");
  await expect(page.getByText("Written by hand before the form existed")).toBeVisible(); // a plain note, never the regex
  const body = await page.locator("body").innerText();
  for (const leak of ["(?:", "\\w", "[#@]"]) expect(body).not.toContain(leak);
  await start.click();

  const progress = page.getByTestId("verify-progress");
  await expect(progress).toContainText("Verification finished", { timeout: 60_000 });
  await expect(progress).toContainText("5 of 5 URLs");
  await expect(page.getByTestId("snapshot-note")).toContainText('Brand set "mokobara", rules copied when this verification started.');
  await expect(page.getByTestId("chip-Verified")).toContainText("1");
  // /gone (404, brand in snippet) and the Reddit thread (never fetched, brand in snippet) both fall back to a
  // SERP-only match instead of staying Unsupported/Unreachable.
  await expect(page.getByTestId("chip-Search snippet match")).toContainText("2");
  await expect(page.getByTestId("chip-Weak mention")).toContainText("1"); // article-3: 1 of 5 non-lead paragraphs

  await expect(page.getByTestId("verify-total")).toHaveText("6");

  // The Evidence column shows SERP on the two fallback rows and PAGE on the normally-verified one.
  await page.getByTestId("chip-Search snippet match").click();
  await expect(page.getByLabel("Hide duplicates")).toBeChecked();
  await expect(page.getByTestId("verify-total")).toHaveText("2");
  for (const badge of await page.getByTestId("evidence-badge").all()) await expect(badge).toHaveText("SERP");
  await page.getByTestId("chip-Search snippet match").click(); // deselect

  await page.getByTestId("chip-Verified").click();
  // Chips count unique URLs by status; selecting one hides duplicates in the table by default.
  await expect(page.getByLabel("Hide duplicates")).toBeChecked();
  await expect(page.getByTestId("verify-total")).toHaveText("1");
  await expect(page.getByTestId("evidence-badge").first()).toHaveText("PAGE");
  await page.getByLabel("Hide duplicates").uncheck();
  await expect(page.getByTestId("verify-total")).toHaveText("2");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download verified xlsx" }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/_verified_\d+\.xlsx$/);
  await shot(page, "run-verified", info);

  await page.getByTestId("continue-to-clean").click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}\/clean$/);
  await expect(page.getByRole("heading", { name: "3. Clean" })).toBeVisible();
  await expect(page.getByTestId("clean-source")).toContainText('brand set "mokobara"');
  await expect(page.getByTestId("cleaning-details")).toBeVisible();
  await page.getByRole("button", { name: "Start cleaning" }).click();
  await expect(page.getByTestId("clean-status")).toHaveText("Cleaning finished", { timeout: 60_000 });
  const summary = page.getByTestId("clean-summary");
  // 6 rows in: article-1 twice (one with utm_source), the travel-tips page that never names Mokobara, and three
  // other Mokobara pages - so 5 unique links, 1 duplicate, 1 to Low Quality and 4 in Clean Data.
  await expect(summary).toContainText("Rows in6");
  await expect(summary).toContainText("Unique links5");
  await expect(summary).toContainText("Duplicates set aside1");
  await expect(summary).toContainText("Clean Data4");
  await expect(summary).toContainText("Reddit1");
  await expect(summary).toContainText("Low Quality1");
  const [cleaned] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download cleaned xlsx" }).click(),
  ]);
  expect(cleaned.suggestedFilename()).toMatch(/^mokobara_RepScore_clean.*_\d+\.xlsx$/);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await shot(page, "run-cleaned", info);

  await page.getByTestId("continue-to-done").click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}\/done$/);
  await expect(page.getByRole("heading", { name: "4. Done" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download cleaned xlsx" })).toBeVisible();
  // Wait for the slide transition to actually finish (not a fixed timeout) before the pixel-review screenshot.
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await shot(page, "run-done", info);
});
