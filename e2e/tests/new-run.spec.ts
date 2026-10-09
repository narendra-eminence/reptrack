import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test("previews parsed queries and billable pages before spending", async ({ page }, info) => {
  await page.goto("/runs/new");
  await expect(page.getByRole("heading", { name: "New run", level: 1 })).toBeVisible();
  await page.getByLabel("Queries").fill('"Mokobara, luggage" OR Mokobara\nmokobara review');
  await expect(page.getByTestId("plan-count")).toHaveText("3"); // the comma split is visible, not silent
  await page.getByText("Show parsed queries").click();
  await expect(page.getByTestId("parsed-queries").getByRole("listitem")).toHaveCount(3);
  await expect(page.getByTestId("plan-max")).toHaveText("3");
  await expect(page.getByTestId("plan-cached")).toHaveText("0");
  await expect(page.getByText("Maximum billable SERP pages")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("$");

  await page.getByLabel("Pages per query").fill("5");
  await expect(page.getByTestId("plan-max")).toHaveText("15");
  await page.getByLabel("Vertical").selectOption("news");
  await expect(page.getByTestId("plan-pages")).toHaveText("1");
  await expect(page.getByTestId("plan-max")).toHaveText("3");
  await expect(page.getByLabel("Pages per query")).toHaveValue("1");
  await expect(page.getByLabel("Pages per query")).toBeDisabled();
  await shot(page, "new-run", info);

  await expect(page.getByLabel("Region")).toHaveValue("in");
  await page.getByLabel("Region").selectOption("us");
  await expect(page.getByTestId("plan-max")).toHaveText("3");

  await page.getByRole("button", { name: "Run search" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("up to 3 billable SERP page requests");
  await expect(dialog).toContainText("searching from United States");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.getByLabel("Start date").fill("2026-09-01");
  await page.getByLabel("End date").fill("2026-08-01");
  await expect(page.getByRole("alert").filter({ hasText: "after end date" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run search" })).toBeDisabled();
  await page.getByLabel("End date").fill("");
  await expect(page.getByRole("alert").filter({ hasText: "together" })).toBeVisible();
});
