import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

const PRIMARY = '[data-primary-action="true"]';
const STEPS = ["search", "verify", "clean", "done"] as const;

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

  // Once a verification is done, the redirect goes to /clean; once a cleaning is done, straight to /done.
  await page.getByLabel("Brand set").selectOption("mokobara");
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("verify-progress")).toContainText("Verification finished", { timeout: 60_000 });
  await page.goto(`/runs/${runId}`);
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/clean$`));
  await page.getByRole("button", { name: "Start cleaning" }).click();
  await expect(page.getByTestId("clean-status")).toHaveText("Cleaning finished", { timeout: 60_000 });
  await page.goto(`/runs/${runId}`);
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/done$`));
});

test("redirect lands on /search for a fresh run with zero SERP rows", async ({ page }, info) => {
  // A run whose only query fails leaves counts.serp_rows at 0, so it must not be sent to /verify.
  await createRun(page, [`fail: broken query ${info.project.name}`]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  await expect(page.getByTestId("search-progress")).toContainText("0 results");
  await expect(page.getByTestId("serp-total")).toHaveCount(0); // no rows -> the results table isn't rendered at all
  const url = page.url();
  const runId = url.match(/\/runs\/([0-9a-f]{12})\//)?.[1];
  if (!runId) throw new Error(`could not extract run id from ${url}`);

  await page.goto(`/runs/${runId}`);
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/search$`));
});

test("locked steps stay locked and direct URLs show the fallback panel", async ({ page }, info) => {
  const name = `mokobara luggage wf-locked ${info.project.name}`;
  await createRun(page, [name, "fail: broken query"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  const url = page.url();
  const runId = url.match(/\/runs\/([0-9a-f]{12})\//)?.[1];
  if (!runId) throw new Error(`could not extract run id from ${url}`);

  // Clean and Done are not clickable before any verification has finished.
  await expect(page.getByTestId("step-clean")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("step-done")).toHaveAttribute("aria-disabled", "true");

  // Direct URLs to locked steps show a fallback panel with a working link back, not a blank page.
  await page.goto(`/runs/${runId}/clean`);
  await expect(page.getByTestId("locked-step")).toContainText("Available once a verification has finished.");
  await page.goto(`/runs/${runId}/done`);
  const locked = page.getByTestId("locked-step");
  await expect(locked).toContainText("Available once a cleaning has finished.");
  await locked.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/(search|verify)$`));
});

test("verify locked panel shows on a zero-result run with a working link back", async ({ page }, info) => {
  await createRun(page, [`fail: broken query wf-verify-locked ${info.project.name}`]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  const url = page.url();
  const runId = url.match(/\/runs\/([0-9a-f]{12})\//)?.[1];
  if (!runId) throw new Error(`could not extract run id from ${url}`);

  await page.goto(`/runs/${runId}/verify`);
  const locked = page.getByTestId("locked-step");
  await expect(locked).toContainText("Available once the search has results.");
  await locked.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/search$`));
});

test("continue buttons navigate to the next step, and at most one red primary button shows at a time", async ({ page }, info) => {
  const name = `mokobara luggage wf-continue ${info.project.name}`;
  await createRun(page, [name, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  await expect(page.locator(PRIMARY)).toHaveCount(1); // Continue to Verify

  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}\/verify$/);
  await expect(page.locator(PRIMARY)).toHaveCount(1); // Start verification, before any verification exists

  await page.getByLabel("Brand set").selectOption("mokobara");
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("verify-progress")).toContainText("Verification finished", { timeout: 60_000 });
  await expect(page.locator(PRIMARY)).toHaveCount(1); // Continue to Clean; Start verification is now outline
  await expect(page.getByRole("button", { name: "Start verification" })).not.toHaveAttribute("data-primary-action", "true");

  await page.getByTestId("continue-to-clean").click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}\/clean$/);
  await expect(page.locator(PRIMARY)).toHaveCount(1); // Start cleaning, before any cleaning exists
  await page.getByRole("button", { name: "Start cleaning" }).click();
  await expect(page.getByTestId("clean-status")).toHaveText("Cleaning finished", { timeout: 60_000 });
  await expect(page.locator(PRIMARY)).toHaveCount(1); // Continue to Done; Start cleaning is now outline
  await expect(page.getByRole("button", { name: "Start cleaning" })).not.toHaveAttribute("data-primary-action", "true");

  await page.getByTestId("continue-to-done").click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f]{12}\/done$/);
  await expect(page.getByRole("heading", { name: "4. Done" })).toBeVisible();
  await expect(page.locator(PRIMARY)).toHaveCount(0); // Done has no red primary button
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

test("step URL state survives a slide to another step and back, reload, Back/Forward and a page change", async ({ page }, info) => {
  const first = `mokobara luggage wf-urlstate-a ${info.project.name}`;
  await createRun(page, [first, "mokobara review", "fail: broken query"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  await page.getByLabel("Search results").fill("article-3");
  await expect(page.getByTestId("serp-total")).toHaveText("1");
  await expect(page).toHaveURL(/[?&]q=article-3/);

  await page.reload();
  await expect(page.getByLabel("Search results")).toHaveValue("article-3");
  await expect(page.getByTestId("serp-total")).toHaveText("1");

  // Sliding to another step and back via the stepper restores the step's own last query string - the shell
  // remembers it per step for this run, independent of history.
  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/[?&]q=article-3/);
  await expect(page.getByLabel("Search results")).toHaveValue("article-3");
  await expect(page.getByTestId("serp-total")).toHaveText("1");

  // Browser Back/Forward replay history exactly, restoring the filtered URL and its state too.
  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  await page.goBack();
  await expect(page).toHaveURL(/[?&]q=article-3/);
  await expect(page.getByLabel("Search results")).toHaveValue("article-3");
  await page.goForward();
  await expect(page).toHaveURL(/\/verify$/);

  // The page number round-trips the same way: set it directly, then reload and go back to it.
  await page.goto(`/runs/${page.url().match(/runs\/([0-9a-f]{12})/)?.[1]}/search?page=2`);
  await expect(page).toHaveURL(/[?&]page=2/);
  await page.reload();
  await expect(page).toHaveURL(/[?&]page=2/);
  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/[?&]page=2/);
});

test("verify URL state (status chip, hide duplicates, filter) survives a slide to another step, reload and Back/Forward", async ({ page }, info) => {
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

  // Sliding to another step and back via the stepper restores the chip/hide-duplicates/filter selection - the
  // shell remembers Verify's own last query string independent of history.
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByTestId("step-verify").click();
  await expect(page).toHaveURL(/[?&]status=Verified/);
  await expect(page.getByTestId("chip-Verified")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Hide duplicates")).toBeChecked();

  // Browser Back/Forward replay history exactly too.
  await page.getByLabel("Hide duplicates").uncheck();
  await expect(page).toHaveURL(/[?&]dups=show/);
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goBack();
  await expect(page).toHaveURL(/[?&]dups=show/);
  await expect(page.getByLabel("Hide duplicates")).not.toBeChecked();
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

test("clicking the current step's own stepper link does not freeze navigation", async ({ page }, info) => {
  const name = `mokobara luggage wf-selfclick ${info.project.name}`;
  await createRun(page, [name, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  // Clicking Search's own stepper link while already on Search: there is no pathname change to animate
  // against, so this must resolve immediately rather than waiting on a settle that will never come.
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/\/search$/);

  // The very next interaction must land within a second, proving the click above never left anything hung.
  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/, { timeout: 1_000 });
});

test("the stepper does not shift position between steps", async ({ page }, info) => {
  const name = `mokobara luggage wf-stepper-shift ${info.project.name}`;
  await createRun(page, [name, "mokobara review"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  async function assertStepperGeometry() {
    for (const key of STEPS) {
      const badge = await page.getByTestId(`step-${key}-badge`).boundingBox();
      const label = await page.getByTestId(`step-${key}-label`).boundingBox();
      if (!badge || !label) throw new Error(`missing boundingBox for step ${key}`);
      const badgeCenterY = badge.y + badge.height / 2;
      const labelCenterY = label.y + label.height / 2;
      expect(Math.abs(badgeCenterY - labelCenterY)).toBeLessThanOrEqual(1);
    }
    // Equal gaps on both sides of each connector: badge-to-label gap within a step should match the
    // label-to-connector and connector-to-next-badge gaps (a stray width around the label would break this).
    for (let i = 0; i < STEPS.length - 1; i++) {
      const label = await page.getByTestId(`step-${STEPS[i]}-label`).boundingBox();
      const connector = await page.getByTestId(`step-connector-${i}`).boundingBox();
      const nextBadge = await page.getByTestId(`step-${STEPS[i + 1]}-badge`).boundingBox();
      if (!label || !connector || !nextBadge) throw new Error("missing boundingBox around connector");
      const gapBefore = connector.x - (label.x + label.width);
      const gapAfter = nextBadge.x - (connector.x + connector.width);
      expect(Math.abs(gapBefore - gapAfter)).toBeLessThanOrEqual(1);
    }
    return {
      search: (await page.getByTestId("step-search").boundingBox())?.x,
      verify: (await page.getByTestId("step-verify").boundingBox())?.x,
    };
  }

  const atSearch = await assertStepperGeometry();

  await page.getByTestId("continue-to-verify").click();
  await expect(page).toHaveURL(/\/verify$/);
  const atVerify = await assertStepperGeometry();
  expect(atVerify.search).toBe(atSearch.search);
  expect(atVerify.verify).toBe(atSearch.verify);

  await page.getByLabel("Brand set").selectOption("mokobara");
  await page.getByRole("button", { name: "Start verification" }).click();
  await expect(page.getByTestId("verify-progress")).toContainText("Verification finished", { timeout: 60_000 });
  await page.getByTestId("continue-to-clean").click();
  await expect(page).toHaveURL(/\/clean$/);
  const atClean = await assertStepperGeometry();
  expect(atClean.search).toBe(atSearch.search);
  expect(atClean.verify).toBe(atSearch.verify);
  await page.getByRole("button", { name: "Start cleaning" }).click();
  await expect(page.getByTestId("clean-status")).toHaveText("Cleaning finished", { timeout: 60_000 });
  await page.getByTestId("continue-to-done").click();
  await expect(page).toHaveURL(/\/done$/);
  const atDone = await assertStepperGeometry();
  expect(atDone.search).toBe(atSearch.search);
  expect(atDone.verify).toBe(atSearch.verify);
});

test("a keystroke typed just before leaving the filter box is not lost", async ({ page }, info) => {
  const first = `mokobara luggage wf-blurflush ${info.project.name}`;
  await createRun(page, [first, "mokobara review", "fail: broken query"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");

  await page.getByLabel("Search results").fill("article-3");
  // Tab away immediately - well inside the 300ms debounce window - instead of waiting for it to fire on its own.
  await page.keyboard.press("Tab");
  await expect(page).toHaveURL(/[?&]q=article-3/);
  await expect(page.getByTestId("serp-total")).toHaveText("1");
});

test("clicking the current step's own link keeps its filter (not one render stale)", async ({ page }, info) => {
  const first = `mokobara luggage wf-selfclick-query ${info.project.name}`;
  await createRun(page, [first, "mokobara review", "fail: broken query"]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  await page.getByLabel("Search results").fill("article-3");
  await expect(page).toHaveURL(/[?&]q=article-3/);

  // A fresh load of the filtered URL, then clicking Search's own current-step link, must not clear the filter -
  // the href must come from the live URL, not a step-query cache that hasn't been written yet.
  const url = page.url();
  await page.goto(url);
  await expect(page.getByLabel("Search results")).toHaveValue("article-3");
  await page.getByTestId("step-search").click();
  await expect(page).toHaveURL(/[?&]q=article-3/);
  await expect(page.getByLabel("Search results")).toHaveValue("article-3");
});
