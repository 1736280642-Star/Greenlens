import { defineConfig, devices } from "@playwright/test";

const existingBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: "pw-results",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: existingBaseUrl ?? "http://127.0.0.1:3130",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: existingBaseUrl ? undefined : {
    command: "npx next dev -H 127.0.0.1 -p 3130",
    url: "http://127.0.0.1:3130/dashboard",
    env: { ...process.env, NEXT_PUBLIC_ANALYSIS_REPOSITORY: "mock" },
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
