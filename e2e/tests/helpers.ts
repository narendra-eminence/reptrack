import { expect, type Page, type TestInfo } from "@playwright/test";

export async function createRun(page: Page, queries: string[]) {
  await page.goto("/runs/new");
  await page.getByLabel("Queries").fill(queries.join("\n"));
  await expect(page.getByTestId("plan-count")).toHaveText(String(queries.length));
  await page.getByRole("button", { name: "Run search" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm and run" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}$/);
}

export async function shot(page: Page, name: string, info: TestInfo) {
  await page.screenshot({ path: info.outputPath(`${name}-${info.project.name}.png`), fullPage: true });
}
