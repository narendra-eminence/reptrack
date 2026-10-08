import { expect, type Page, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

async function addTag(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Enter");
}

async function addTest(page: Page, brand: number, text: string, expectation: "Match" | "Not a match") {
  await page.getByLabel(`Brand ${brand} new test sentence`, { exact: true }).fill(text);
  await page.getByLabel(`Brand ${brand} new test expectation`, { exact: true }).selectOption({ label: expectation });
  await page.getByRole("region", { name: `Brand ${brand} test configuration` }).getByRole("button", { name: "Add", exact: true }).click();
}

const testRow = (page: Page, brand: number, text: string) =>
  page.getByTestId(`tests-brand-${brand}`).getByRole("listitem").filter({ hasText: text });

const results = (page: Page, brand: number) => page.getByTestId(`tests-brand-${brand}`).getByTestId("test-result");

const setButton = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}`) });

test("create a set with people and test sentences, save, reload, add a brand, verify and delete", async ({ page }, info) => {
  const name = `zeta-${info.project.name}`;
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill(name);
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Zeta");
  await page.getByLabel("Brand 1 description", { exact: true }).fill("Indian luggage maker");
  await addTag(page, "Brand 1 aliases", "Zeta Industries");
  await addTag(page, "Brand 1 hashtags", "zetabags");
  await expect(page.getByLabel("Brand 1 common word no")).toBeChecked();
  await expect(page.getByLabel("Brand 1 confirming words")).toHaveCount(0);
  await page.getByLabel("Brand 1 common word yes").check();
  await addTag(page, "Brand 1 confirming words", "luggage");
  await addTag(page, "Brand 1 not after", "browser");
  await addTag(page, "Brand 1 not nearby", "Kruger");
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByLabel("Brand 1 person 1 name", { exact: true }).fill("Jo Bloggs");

  await addTest(page, 1, "Zeta Industries shares rose today", "Match");
  await addTest(page, 1, "Open it in Zeta browser", "Not a match");
  await addTest(page, 1, "We went to Zeta near Kruger", "Not a match");
  await addTest(page, 1, "Zeta trolley sale", "Match");
  await expect(page.getByTestId("tests-brand-1").getByRole("listitem")).toHaveCount(4);
  await expect(results(page, 1).filter({ hasText: "Passes" })).toHaveCount(3);
  await expect(testRow(page, 1, "Zeta trolley sale").getByTestId("test-result")).toHaveText("Fails");
  await expect(testRow(page, 1, "Zeta Industries shares rose today").locator("mark").first()).toHaveText("Zeta Industries");
  await expect(testRow(page, 1, "Open it in Zeta browser")).toContainText(" - ");
  await expect(testRow(page, 1, "Zeta trolley sale")).toContainText("no confirming word nearby");

  await addTag(page, "Brand 1 confirming words", "trolley");
  await expect(results(page, 1).filter({ hasText: "Passes" })).toHaveCount(4);

  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.reload();
  await expect(setButton(page, name)).toContainText("Form");
  await setButton(page, name).click();
  await expect(page.getByLabel("Brand 1 name", { exact: true })).toHaveValue("Zeta");
  await expect(page.getByLabel("Brand 1 description", { exact: true })).toHaveValue("Indian luggage maker");
  await expect(page.getByLabel("Brand 1 common word yes")).toBeChecked();
  await expect(page.getByRole("button", { name: "Remove Zeta Industries" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove zetabags" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove browser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Kruger" })).toBeVisible();
  await expect(page.getByLabel("Brand 1 person 1 name", { exact: true })).toHaveValue("Jo Bloggs");
  await expect(page.getByTestId("tests-brand-1").getByRole("listitem")).toHaveCount(4);
  await expect(results(page, 1).filter({ hasText: "Passes" })).toHaveCount(4);

  // A new brand without a name does not stop the other brands' sentences from being checked.
  await page.getByRole("button", { name: "Add another brand" }).click();
  await addTest(page, 2, "Geniux luggage is light", "Match");
  await expect(page.getByText("Name this brand to check its sentences.")).toBeVisible();
  await expect(results(page, 2)).toHaveText(["Not checked"]);
  await addTag(page, "Brand 1 confirming words", "bag");
  await expect(results(page, 1).filter({ hasText: "Passes" })).toHaveCount(4);
  await expect(page.getByText("Brand 2: Brand name")).toHaveCount(0); // the API's refusal of an unnamed brand is never shown
  await page.getByLabel("Brand 2 name", { exact: true }).fill("Geniux");
  await page.getByLabel("Brand 2 common word yes").check();
  await addTag(page, "Brand 2 confirming words", "luggage");
  await expect(results(page, 2)).toHaveText(["Passes"]);
  await addTest(page, 1, "Geniux luggage is light", "Match");
  const geniuxUnderZeta = testRow(page, 1, "Geniux luggage is light");
  await expect(geniuxUnderZeta.getByTestId("test-result")).toHaveText("Fails");
  await expect(geniuxUnderZeta).toContainText("Counted for Geniux");

  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByRole("status")).toContainText("1 test sentence");
  await shot(page, "brands-form", info);

  const original = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: 400, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "brands-form-narrow", info);
  await page.setViewportSize(original);

  // The set is offered for verification like any other.
  await createRun(page, [`zeta luggage f-${info.project.name}`]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  await page.getByTestId("continue-to-verify").click();
  await expect(page.getByLabel("Brand set").locator("option", { hasText: name })).toHaveCount(1);
  await page.getByLabel("Brand set").selectOption(name);
  const summary = page.getByTestId("brand-summary");
  await expect(summary).toContainText("Zeta");
  await expect(summary).toContainText("Indian luggage maker");
  await expect(summary).toContainText("Other names: Zeta Industries");
  await expect(summary).toContainText("Hashtags: #zetabags");
  await expect(summary).toContainText("Confirmed by: luggage, trolley, bag");
  await expect(summary).toContainText("Not when after: browser");
  await expect(summary).toContainText("Not in the same sentence as: Kruger");
  await expect(summary).toContainText("People: Jo Bloggs");
  const text = await summary.innerText();
  for (const leak of ["(?:", "\\w", "[#@]"]) expect(text).not.toContain(leak);
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
  await shot(page, "verify-brand-summary", info);

  await page.goto("/brands");
  await setButton(page, name).click();
  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(setButton(page, name)).toHaveCount(0);
});

test("switching common word back to No clears the hidden fields so the set saves", async ({ page }, info) => {
  const name = `eta-${info.project.name}`;
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill(name);
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Eta");
  await page.getByLabel("Brand 1 common word yes").check();
  await addTag(page, "Brand 1 confirming words", "x");
  await addTag(page, "Brand 1 phrases to ignore", "Eta Carinae");
  await page.getByLabel("Brand 1 common word no").check();
  await expect(page.getByLabel("Brand 1 confirming words")).toHaveCount(0);
  await page.getByLabel("Brand 1 common word yes").check();
  await expect(page.getByRole("button", { name: "Remove x" })).toHaveCount(0); // the values were cleared, not just hidden
  await page.getByLabel("Brand 1 common word no").check();
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0); // Next.js keeps an empty route announcer alert

  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(setButton(page, name)).toHaveCount(0);
});

test("the form refuses a hand-written set's name", async ({ page }) => {
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill("mokobara");
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Mokobara");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /already exists|hand-written/ })).toBeVisible();
});

test("no rule pattern is shown anywhere on the form", async ({ page }) => {
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill("theta-regex");
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Theta");
  await addTag(page, "Brand 1 aliases", "Theta Labs");
  await addTag(page, "Brand 1 hashtags", "thetabags");
  await addTag(page, "Brand 1 handles", "thetalabs");
  await page.getByLabel("Brand 1 common word yes").check();
  await addTag(page, "Brand 1 confirming words", "luggage");
  await addTag(page, "Brand 1 not before", "Greek");
  await page.getByRole("button", { name: "Add person" }).click();
  await page.getByLabel("Brand 1 person 1 name", { exact: true }).fill("Ann Example");
  await page.getByLabel("Brand 1 person 1 only when brand nearby", { exact: true }).check();
  await addTest(page, 1, "Greek Theta and #thetabags", "Match");
  await expect(results(page, 1)).toHaveText(["Passes"]);
  const body = await page.locator("body").innerText();
  for (const bit of ["(?:", "\\w", "[#@]"]) expect(body).not.toContain(bit);
});
