import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

test("redirect lands on the right step from persisted state", async ({ page }, info) => {
  const name = `mokobara luggage wf-redirect ${info.project.name}`;
  await createRun(page, [name, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  const url = page.url();
  const runId = url.match(/\/runs\/([0-9a-f]{12})\//)?.[1];
  if (!runId) throw new Error(`could not extract run id from ${url}`);

  // A fresh scraping run with results already lands on /verify (search finished, results exist).
  await page.goto(`/runs/${runId}`);
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/verify$`));

  // Once a verification is done, the redirect goes straight to /done.
  await page.getByLabel("Brand set").selectOption("mokobara");
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("verify-progress")).toContainText("Verification finished", { timeout: 60_000 });
  await page.goto(`/runs/${runId}`);
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/done$`));
});

test("locked steps stay locked and direct URLs show the fallback panel", async ({ page }, info) => {
  const name = `mokobara luggage wf-locked ${info.project.name}`;
  await createRun(page, [name, "fail: broken query"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  const url = page.url();
  const runId = url.match(/\/runs\/([0-9a-f]{12})\//)?.[1];
  if (!runId) throw new Error(`could not extract run id from ${url}`);

  // Done is not clickable before any verification has finished.
  const doneStep = page.getByTestId("step-done");
  await expect(doneStep).toHaveAttribute("aria-disabled", "true");

  // Direct URL to the locked Done step shows a fallback panel with a working link back, not a blank page.
  await page.goto(`/runs/${runId}/done`);
  const locked = page.getByTestId("locked-step");
  await expect(locked).toContainText("Available once a verification has finished.");
  await locked.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/(search|verify)$`));
});

test("continue buttons navigate to the next step", async ({ page }, info) => {
  const name = `mokobara luggage wf-continue ${info.project.name}`;
  await createRun(page, [name, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}\/verify$/);

  await page.getByLabel("Brand set").selectOption("mokobara");
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("verify-progress")).toContainText("Verification finished", { timeout: 60_000 });
  await page.getByTestId("continue-to-done").click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}\/done$/);
  await expect(page.getByRole("heading", { name: "3. Done" })).toBeVisible();
});

test("switching steps does not reconnect the SSE stream or refetch the run", async ({ page }, info) => {
  const name = `mokobara luggage wf-noreconnect ${info.project.name}`;
  await createRun(page, [name, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  const eventRequests: string[] = [];
  const runRequests: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/events")) eventRequests.push(u);
    else if (/\/api\/runs\/[0-9a-f]{12}$/.test(new URL(u).pathname)) runRequests.push(u);
  });

  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByTestId("step-verify").click();
  await expect(page).toHaveURL(/\/verify$/);

  expect(eventRequests).toHaveLength(0);
  expect(runRequests).toHaveLength(0);
});

test("step URL state survives navigation, reload and back/forward", async ({ page }, info) => {
  const first = `mokobara luggage wf-urlstate-a ${info.project.name}`;
  await createRun(page, [first, "mokobara review", "fail: broken query"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  await page.getByLabel("Search results").fill("article-3");
  await expect(page.getByTestId("serp-total")).toHaveText("1");
  await expect(page).toHaveURL(/[?&]q=article-3/);

  await page.reload();
  await expect(page.getByLabel("Search results")).toHaveValue("article-3");
  await expect(page.getByTestId("serp-total")).toHaveText("1");

  // Sliding to another step and back via the stepper - each is its own navigation, not history replay, so the
  // stepper always lands on the step's plain URL (no carried-over filter).
  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(new RegExp(`/search$`));
  await expect(page.getByLabel("Search results")).toHaveValue("");

  // Browser Back/Forward replay history exactly, restoring the filtered URL and its state.
  await page.getByLabel("Search results").fill("article-3");
  await expect(page).toHaveURL(/[?&]q=article-3/);
  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  await page.goBack();
  await expect(page).toHaveURL(/[?&]q=article-3/);
  await expect(page.getByLabel("Search results")).toHaveValue("article-3");
  await expect(page.getByTestId("serp-total")).toHaveText("1");
  await page.goForward();
  await expect(page).toHaveURL(/\/verify$/);
});

test("verify URL state (status chip, hide duplicates, filter) survives navigation and reload", async ({ page }, info) => {
  const name = `mokobara luggage wf-verify-urlstate ${info.project.name}`;
  await createRun(page, [name, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  await page.getByTestId("continue-to-verify").click();
  await page.getByLabel("Brand set").selectOption("mokobara");
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("verify-progress")).toContainText("Verification finished", { timeout: 60_000 });

  await page.getByTestId("chip-Verified").click();
  await expect(page).toHaveURL(/[?&]status=Verified/);
  await expect(page.getByLabel("Hide duplicates")).toBeChecked();

  await page.reload();
  await expect(page.getByTestId("chip-Verified")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Hide duplicates")).toBeChecked();

  // Sliding to another step and back via the stepper is a fresh navigation, not history replay: the chip
  // selection does not carry over (the plain Verify URL, unfiltered, is shown instead).
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByTestId("step-verify").click();
  await expect(page).toHaveURL(new RegExp(`/verify$`));
  await expect(page.getByTestId("chip-Verified")).toHaveAttribute("aria-pressed", "false");

  // Browser Back/Forward replay history exactly, restoring the selected chip and its state.
  await page.getByTestId("chip-Verified").click();
  await expect(page).toHaveURL(/[?&]status=Verified/);
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goBack();
  await expect(page).toHaveURL(/[?&]status=Verified/);
  await expect(page.getByTestId("chip-Verified")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Hide duplicates")).toBeChecked();
});

test("step navigation ends on the right URL and content, with and without reduced motion", async ({ page }, info) => {
  const name = `mokobara luggage wf-animation ${info.project.name}`;
  await createRun(page, [name, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByRole("heading", { name: "2. Verify" })).toBeVisible();
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("heading", { name: "1. Search" })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByRole("heading", { name: "2. Verify" })).toBeVisible();
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("heading", { name: "1. Search" })).toBeVisible();
  await shot(page, "workflow-animation-end", info);
});
