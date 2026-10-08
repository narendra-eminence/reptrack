import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

const REGEX_BITS = ["(?:", "\\w", "[#@]"];

test("a hand-written set is read-only, shows no rules, and can be deleted", async ({ page }, info) => {
  await page.goto("/brands");
  await expect(page.getByRole("heading", { name: "Brand sets", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "New raw set" })).toHaveCount(0);

  const moko = page.getByRole("button", { name: /^mokobara/ });
  await expect(moko).toContainText("Hand-written");
  await moko.click();
  await expect(page.getByRole("heading", { name: "mokobara" })).toBeVisible();
  await expect(
    page.getByText(
      "Written by hand before the form existed. It still works for verification. To change it, create it again with the form.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete set" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save set" })).toHaveCount(0);
  const body = await page.locator("body").innerText();
  for (const bit of REGEX_BITS) expect(body).not.toContain(bit);
  await shot(page, "brands-handwritten", info);

  // Each Playwright project deletes its own copy of the hand-written "other" set (the fixture config is shared by both).
  const name = `other-${info.project.name}`;
  const other = page.getByRole("button", { name: new RegExp(`^${name}`) });
  await other.click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(other).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: /^mokobara/ })).toBeVisible();
  await expect(other).toHaveCount(0);
});
