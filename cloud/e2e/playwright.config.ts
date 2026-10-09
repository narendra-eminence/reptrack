import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a real Supabase (local only, see global-setup.ts) and a fake SerpAPI.
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   from `npx supabase status`
//   PW_CHROMIUM_PATH   optional: a Chromium binary to use instead of Playwright's download
const PORT = 3200;
const SERP_PORT = 4010;
const chromium = process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {};

export default defineConfig({
  testDir: "./tests",
  outputDir: "../test-results",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", acceptDownloads: true },
  projects: [
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, ...chromium } },
  ],
  webServer: [
    {
      command: "node fake-serpapi.mjs",
      url: `http://127.0.0.1:${SERP_PORT}/health`,
      env: { FAKE_SERPAPI_PORT: String(SERP_PORT), SERPAPI_KEY: "e2e-key" },
      reuseExistingServer: false,
    },
    {
      // A production build, like Vercel runs, not the dev server.
      command: `npm run build && npm run start -- --port ${PORT}`,
      cwd: "..",
      url: `http://localhost:${PORT}/login`,
      env: { SERPAPI_KEY: "e2e-key", SERPAPI_BASE_URL: `http://127.0.0.1:${SERP_PORT}/search` },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
