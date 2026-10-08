import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

async function addTag(page: import("@playwright/test").Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Enter");
}

test("create, try, save, reload and edit a brand set from the simple form", async ({ page }, info) => {
  const name = `zeta-${info.project.name}`;
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill(name);
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Zeta");
  await page.getByLabel("Brand 1 short name is also an everyday word").check();
  await page.getByLabel("Brand 1 everyday word").fill("Zeta");
  await expect(page.getByText("so every use of the word counts")).toBeVisible(); // preview warning: nothing confirms the word yet
  await addTag(page, "Brand 1 names that always mean this brand", "Zeta Industries");
  await addTag(page, "Brand 1 confirming words", "luggage");
  await addTag(page, "Brand 1 not followed by", "browser");
  await expect(page.getByText("so every use of the word counts")).toHaveCount(0);

  await page.getByLabel("Sample text").fill("Zeta Industries rose. Open it in Zeta browser. Zeta luggage is light.");
  await page.getByRole("button", { name: "Try rules" }).click();
  await expect(page.getByTestId("try-hits").getByRole("listitem")).toHaveCount(2);
  await expect(page.getByTestId("try-excluded")).toContainText("Not counted: followed by browser");
  await expect(page.getByTestId("try-excluded")).not.toContainText("(?i:");

  await page.getByRole("button", { name: "Show generated rules" }).click();
  await expect(page.getByTestId("generated-rules")).toContainText("Zeta");

  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await shot(page, "brands-form", info);

  const original = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: 400, height: 900 });
  await shot(page, "brands-form-narrow", info);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize(original);

  await page.reload();
  const setButton = page.getByRole("button", { name: new RegExp(`^${name}`) });
  await expect(setButton).toContainText("Form");
  await setButton.click();
  await expect(page.getByLabel("Brand 1 name", { exact: true })).toHaveValue("Zeta");
  await expect(page.getByRole("button", { name: "Remove browser" })).toBeVisible();
  await addTag(page, "Brand 1 confirming words", "trolley");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  // The set is offered for verification like any other.
  await createRun(page, [`zeta luggage f-${info.project.name}`]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  await page.getByTestId("continue-to-verify").click();
  await expect(page.getByLabel("Brand set").locator("option", { hasText: name })).toHaveCount(1);

  await page.goto("/brands");
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0);
});

test("switching a form set to advanced editing keeps its rules", async ({ page }, info) => {
  const name = `eta-${info.project.name}`;
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill(name);
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Eta");
  await addTag(page, "Brand 1 names that always mean this brand", "Eta Labs");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Switch to advanced editing" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Switch" }).click();
  await expect(page.getByLabel("Rule 1 pattern")).toHaveValue(/Eta/);
  await expect(page.getByRole("button", { name, exact: true })).not.toContainText("Form");
});

test("the form refuses a raw set's name", async ({ page }) => {
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill("mokobara");
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Mokobara");
  await addTag(page, "Brand 1 names that always mean this brand", "Mokobara");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
});
