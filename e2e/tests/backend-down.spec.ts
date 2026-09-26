import { expect, test } from "@playwright/test";

test("tells the user how to start the backend when the API is down", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({ status: 502, body: "Bad Gateway" }));
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "Backend not reachable" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("make dev");
});
