import { expect, type Page, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

async function addTag(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Enter");
}

async function addTest(page: Page, brand: number, text: string, expectation: "Match" | "Not a match") {
  await page.getByLabel(`Brand ${brand}: Add test sentence`, { exact: true }).fill(text);
  await page.getByLabel(`Brand ${brand}: New test sentence expected result`, { exact: true }).selectOption({ label: expectation });
  await page.getByRole("button", { name: `Brand ${brand}: Add`, exact: true }).click();
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
  await page.getByLabel("Brand 1: Brand name", { exact: true }).fill("Zeta");
  await page.getByLabel("Brand 1: Description", { exact: true }).fill("Indian luggage maker");
  await addTag(page, "Brand 1: Other brand names / aliases", "Zeta Industries");
  await addTag(page, "Brand 1: Hashtags", "#zetabags");
  await addTag(page, "Brand 1: Hashtags", "ZetaBags"); // the same hashtag once the # is dropped
  await expect(page.getByRole("button", { name: /^Remove .*zetabags$/i })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove zetabags", exact: true })).toBeVisible();
  await expect(page.getByLabel("Brand 1: Is the brand name a common word? No")).toBeChecked();
  await expect(page.getByLabel("Brand 1: Words that confirm this is the brand")).toHaveCount(0);
  await page.getByLabel("Brand 1: Is the brand name a common word? Yes").check();
  await addTag(page, "Brand 1: Words that confirm this is the brand", "luggage");
  await addTag(page, "Brand 1: Not the brand: After the brand name", "browser");
  await addTag(page, "Brand 1: Not the brand: Nearby / same sentence", "Kruger");
  await page.getByRole("button", { name: "Brand 1: Add person", exact: true }).click();
  await page.getByLabel("Brand 1, person 1: Person", { exact: true }).fill("Jo Bloggs");

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

  await addTag(page, "Brand 1: Words that confirm this is the brand", "trolley");
  await expect(results(page, 1).filter({ hasText: "Passes" })).toHaveCount(4);

  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.reload();
  await expect(setButton(page, name)).toContainText("Form");
  await setButton(page, name).click();
  await expect(page.getByLabel("Brand 1: Brand name", { exact: true })).toHaveValue("Zeta");
  await expect(page.getByLabel("Brand 1: Description", { exact: true })).toHaveValue("Indian luggage maker");
  await expect(page.getByLabel("Brand 1: Is the brand name a common word? Yes")).toBeChecked();
  await expect(page.getByRole("button", { name: "Remove Zeta Industries" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove zetabags" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove browser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Kruger" })).toBeVisible();
  await expect(page.getByLabel("Brand 1, person 1: Person", { exact: true })).toHaveValue("Jo Bloggs");
  await expect(page.getByTestId("tests-brand-1").getByRole("listitem")).toHaveCount(4);
  await expect(results(page, 1).filter({ hasText: "Passes" })).toHaveCount(4);

  // A new brand without a name does not stop the other brands' sentences from being checked.
  await page.getByRole("button", { name: "Add another brand" }).click();
  await addTest(page, 2, "Geniux luggage is light", "Match");
  await expect(page.getByText("Name this brand to check its sentences.")).toBeVisible();
  await expect(results(page, 2)).toHaveText(["Not checked"]);
  await addTag(page, "Brand 1: Words that confirm this is the brand", "bag");
  await expect(results(page, 1).filter({ hasText: "Passes" })).toHaveCount(4);
  await expect(page.getByText("Brand 2: Brand name")).toHaveCount(0); // the API's refusal of an unnamed brand is never shown
  await page.getByLabel("Brand 2: Brand name", { exact: true }).fill("Geniux");
  await page.getByLabel("Brand 2: Is the brand name a common word? Yes").check();
  await addTag(page, "Brand 2: Words that confirm this is the brand", "luggage");
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
  await page.getByLabel("Brand 1: Brand name", { exact: true }).fill("Eta");
  await page.getByLabel("Brand 1: Is the brand name a common word? Yes").check();
  await addTag(page, "Brand 1: Words that confirm this is the brand", "x");
  await addTag(page, "Brand 1: Exact phrases to ignore", "Eta Carinae");
  await page.getByLabel("Brand 1: Is the brand name a common word? No").check();
  await expect(page.getByLabel("Brand 1: Words that confirm this is the brand")).toHaveCount(0);
  await page.getByLabel("Brand 1: Is the brand name a common word? Yes").check();
  await expect(page.getByRole("button", { name: "Remove x" })).toHaveCount(0); // the values were cleared, not just hidden
  await page.getByLabel("Brand 1: Is the brand name a common word? No").check();
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
  await page.getByLabel("Brand 1: Brand name", { exact: true }).fill("Mokobara");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /already exists|hand-written/ })).toBeVisible();
});

test("no rule pattern is shown anywhere on the form", async ({ page }) => {
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill("theta-regex");
  await page.getByLabel("Brand 1: Brand name", { exact: true }).fill("Theta");
  await addTag(page, "Brand 1: Other brand names / aliases", "Theta Labs");
  await addTag(page, "Brand 1: Hashtags", "thetabags");
  await addTag(page, "Brand 1: Social handles", "thetalabs");
  await page.getByLabel("Brand 1: Is the brand name a common word? Yes").check();
  await addTag(page, "Brand 1: Words that confirm this is the brand", "luggage");
  await addTag(page, "Brand 1: Not the brand: Before the brand name", "Greek");
  await page.getByRole("button", { name: "Brand 1: Add person", exact: true }).click();
  await page.getByLabel("Brand 1, person 1: Person", { exact: true }).fill("Ann Example");
  await page.getByLabel("Brand 1, person 1: Only count when brand is nearby", { exact: true }).check();
  await addTest(page, 1, "Greek Theta and #thetabags", "Match");
  await expect(results(page, 1)).toHaveText(["Passes"]);
  const body = await page.locator("body").innerText();
  for (const bit of ["(?:", "\\w", "[#@]"]) expect(body).not.toContain(bit);
});
