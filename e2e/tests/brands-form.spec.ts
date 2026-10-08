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

test("Suggest offers chips that are only added when clicked", async ({ page }, info) => {
  await page.route("**/api/health", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), suggest_available: true } });
  });
  await page.route("**/api/brand-profiles/suggest", (route) =>
    route.fulfill({
      json: {
        dropped: 0,
        suggestion: {
          always: ["Theta Industries"],
          handles: ["thetabags"],
          everyday_word: {
            word: "Theta", exact_case: true, closeness: "close", confirm: ["luggage", "trolley"],
            not_followed_by: ["function"], not_preceded_by: [], not_in_sentence_with: [], ignore_phrases: [],
          },
          people: [{ name: "Ann Example", common: true }],
          notes: "Collides with the Greek letter.",
        },
      },
    }),
  );
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Theta");
  await page.getByLabel("Brand 1 description").fill("Luggage maker");
  await page.getByRole("button", { name: "Suggest" }).click();
  await expect(page.getByText("Collides with the Greek letter.")).toBeVisible();

  // Nothing is added until clicked.
  await expect(page.getByRole("button", { name: "Remove Theta Industries" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Theta Industries" }).click();
  await expect(page.getByRole("button", { name: "Remove Theta Industries" })).toBeVisible();

  // The everyday-word suggestion turns the section on and its chips appear.
  await page.getByRole("button", { name: "Use everyday word Theta" }).click();
  await expect(page.getByLabel("Brand 1 everyday word")).toHaveValue("Theta");
  await page.getByRole("button", { name: "Add all confirming words" }).click();
  await expect(page.getByRole("button", { name: "Remove trolley" })).toBeVisible();

  await expect(page.getByText("verify - from AI memory")).toBeVisible();
  await shot(page, "brands-suggest", info);
  await page.getByRole("button", { name: "Add Ann Example" }).click();
  await expect(page.getByLabel("Person 1 name")).toHaveValue("Ann Example");
  await expect(page.getByLabel("Person 1 common name")).toBeChecked();
});

test("Suggest is disabled without an API key", async ({ page }) => {
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Theta");
  await expect(page.getByRole("button", { name: "Suggest" })).toBeDisabled();
  await expect(page.getByText("Suggest needs ANTHROPIC_API_KEY")).toBeVisible();
});

async function threeBrandsWithSuggest(page: import("@playwright/test").Page) {
  await page.route("**/api/health", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), suggest_available: true } });
  });
  await page.route("**/api/brand-profiles/suggest", async (route) => {
    const { brand_name } = route.request().postDataJSON();
    if (brand_name === "Beta") await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({
      json: { dropped: 0, suggestion: { always: [], handles: [], everyday_word: null, people: [], notes: `Note for ${brand_name}.` } },
    });
  });
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Brand 1 name", { exact: true }).fill("Alpha");
  for (const [n, name] of [[2, "Beta"], [3, "Gamma"]] as const) {
    await page.getByRole("button", { name: "Add brand", exact: true }).click();
    await page.getByLabel(`Brand ${n} name`, { exact: true }).fill(name);
  }
  return page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Suggest" }) });
}

test("a settled Suggest result stays on its card when an earlier card is removed", async ({ page }) => {
  const cards = await threeBrandsWithSuggest(page);
  await cards.nth(1).getByRole("button", { name: "Suggest" }).click();
  await expect(cards.nth(1).getByText("Note for Beta.")).toBeVisible();
  await page.getByRole("button", { name: "Remove brand" }).first().click();
  await expect(page.getByLabel("Brand 1 name", { exact: true })).toHaveValue("Beta");
  await expect(cards.nth(0).getByText("Note for Beta.")).toBeVisible();
  await expect(cards.nth(1).getByText("Note for Beta.")).toHaveCount(0);
});

test("an in-flight Suggest result lands on its card when an earlier card is removed", async ({ page }) => {
  const cards = await threeBrandsWithSuggest(page);
  await cards.nth(1).getByRole("button", { name: "Suggest" }).click();
  await page.getByRole("button", { name: "Remove brand" }).first().click(); // while Beta is pending
  await expect(page.getByLabel("Brand 1 name", { exact: true })).toHaveValue("Beta");
  await expect(cards.nth(0).getByText("Note for Beta.")).toBeVisible();
  await expect(cards.nth(1).getByText("Note for Beta.")).toHaveCount(0);
  await expect(cards.nth(0).getByRole("button", { name: "Suggest" })).toBeEnabled();
});
