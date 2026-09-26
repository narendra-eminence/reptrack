import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: [
    { command: "node pages-server.mjs", url: "http://127.0.0.1:8200/health", reuseExistingServer: false },
    { command: "bash start-api.sh", url: "http://127.0.0.1:8100/api/health", reuseExistingServer: false, timeout: 90_000 },
    {
      command: "npm run dev -- --port 3100",
      cwd: "../web",
      url: "http://localhost:3100",
      env: { API_ORIGIN: "http://127.0.0.1:8100" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
