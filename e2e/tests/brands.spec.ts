import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test("create, try, validate, save and delete a brand set", async ({ page }, info) => {
  const name = `acme-${info.project.name}`;
  await page.goto("/brands");
  await expect(page.getByRole("heading", { name: "Brand sets", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "New raw set" }).click();
  await page.getByLabel("Set name").fill(name);
  await page.getByLabel("Rule 1 name").fill("Acme");
  await page.getByLabel("Rule 1 pattern").fill("Acme");
  await page.getByLabel("Rule 1 context window").fill("20");
  await page.getByLabel("Rule 1 context words").fill("luggage");
  await page.getByLabel("Rule 1 exclusions").fill("Acme Corp");

  await page.getByLabel("Sample text").fill(
    "Acme luggage is sturdy. Our friends at Acme Corp make anvils for cartoon coyotes everywhere. Then Acme rocks.",
  );
  await page.getByRole("button", { name: "Try rules" }).click();
  await expect(page.getByTestId("try-hits").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("try-excluded")).toContainText("excluded by");
  await expect(page.getByTestId("try-excluded")).toContainText("no context word");

  await page.getByLabel("Rule 1 pattern").fill("Ac(me");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "rule 1 ('Acme')" })).toContainText("pattern");

  await page.getByLabel("Rule 1 pattern").fill("Acme");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByRole("button", { name, exact: true })).not.toContainText("Form");
  await shot(page, "brands", info);

  await page.reload();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByLabel("Rule 1 exclusions")).toHaveValue("Acme Corp");

  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
});
