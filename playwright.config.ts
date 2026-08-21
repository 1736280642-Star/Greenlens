import { defineConfig, devices } from "@playwright/test";

const existingBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  outputDir: "pw-results",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: existingBaseUrl ?? "http://127.0.0.1:3131",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: existingBaseUrl ? undefined : {
    command: "node scripts/start-playwright-server.mjs",
    url: "http://127.0.0.1:3131/dashboard",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
