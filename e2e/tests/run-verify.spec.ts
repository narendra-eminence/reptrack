import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

test("verifies results with a chosen brand set and exports", async ({ page }, info) => {
  await createRun(page, [`mokobara luggage v-${info.project.name}`, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  const start = page.getByRole("button", { name: "Start verification" });
  await expect(start).toBeDisabled();
  await page.getByLabel("Brand set").selectOption("mokobara");
  await expect(page.getByText("Mokobara|MOKOBARA|[#@]mokobara\\w*")).toBeVisible(); // the rules are shown before starting
  await start.click();

  const progress = page.getByTestId("verify-progress");
  await expect(progress).toContainText("Verification finished", { timeout: 60_000 });
  await expect(progress).toContainText("4 of 4 URLs");
  await expect(page.getByTestId("snapshot-note")).toContainText('Brand set "mokobara"');
  await expect(page.getByTestId("chip-Verified")).toContainText("1");
  await expect(page.getByTestId("chip-Page unreachable")).toContainText("1");
  await expect(page.getByTestId("chip-Weak mention")).toContainText("1"); // article-3: 1 of 5 non-lead paragraphs

  await expect(page.getByTestId("verify-total")).toHaveText("5");
  await page.getByTestId("chip-Verified").click();
  await expect(page.getByTestId("verify-total")).toHaveText("2");
  await page.getByLabel("Hide duplicates").check();
  await expect(page.getByTestId("verify-total")).toHaveText("1");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download verified xlsx" }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/_verified_\d+\.xlsx$/);
  await expect(page.getByRole("heading", { name: "3. Done" })).toBeVisible();
  await shot(page, "run-verified", info);
});
