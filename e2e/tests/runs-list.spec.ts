import { expect, test } from "@playwright/test";
import { shot } from "./helpers";

test("runs list shows navigation and the New run action", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Runs", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "New run" })).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Brands" })).toBeVisible();
  // healthy backend: no setup banner. Next's App Router renders its own empty, visually-hidden
  // role="alert" route announcer on every page (see node_modules/next/dist/client/components/
  // app-router-announcer.js), so scope this to alerts that actually carry a message.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
  await shot(page, "runs-list", info);
});
