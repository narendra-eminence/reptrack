import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

// The acme set is used by no run in these specs, so editing its cleaning details cannot change another spec's
// cleaning. Both viewport projects share one API, so the test sets the values it checks rather than assuming them.
test("cleaning details are edited on the Brands page and opened from a link", async ({ page }, info) => {
  await page.goto("/brands?set=acme");
  const panel = page.getByTestId("cleaning-details-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Cleaning details" })).toBeVisible();

  const websites = panel.getByLabel("Own websites");
  const removes = panel.getByRole("button", { name: /^Remove / });
  while ((await removes.count()) > 0) await removes.first().click(); // start from no values
  await websites.fill("not a site");
  await websites.press("Enter");
  await panel.getByRole("button", { name: "Save cleaning details" }).click();
  await expect(panel.getByRole("alert")).toContainText("is not a website");

  await panel.getByRole("button", { name: "Remove not a site" }).click();
  await websites.fill("https://www.Acme-Example.com/about");
  await websites.press("Enter");
  const handles = panel.getByLabel("Own social handles");
  await handles.fill(`@acme_${info.project.name.replace("-", "_")}`);
  await handles.press("Enter");
  await panel.getByRole("button", { name: "Save cleaning details" }).click();
  await expect(panel.getByRole("status")).toContainText("Saved");
  // The server keeps only the website's host.
  await expect(panel.getByRole("button", { name: "Remove acme-example.com" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Save cleaning details" })).toBeDisabled();
  await shot(page, "cleaning-details", info);

  await page.reload();
  await expect(page.getByTestId("cleaning-details-panel").getByRole("button", { name: "Remove acme-example.com" })).toBeVisible();
});
