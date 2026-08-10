import { defineConfig, devices } from "@playwright/test";

const existingBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const localPort = Number(process.env.PLAYWRIGHT_PORT ?? 3130);
const localBaseUrl = `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  outputDir: "pw-results",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: existingBaseUrl ?? localBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: existingBaseUrl ? undefined : {
    command: `npx next dev -H 127.0.0.1 -p ${localPort}`,
    url: `${localBaseUrl}/dashboard`,
    env: { ...process.env, NEXT_PUBLIC_ANALYSIS_REPOSITORY: "mock" },
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
