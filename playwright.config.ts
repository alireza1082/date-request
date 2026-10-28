import { defineConfig, devices } from "@playwright/test";

const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chromeLaunchOptions = chromeExecutable
  ? { launchOptions: { executablePath: chromeExecutable } }
  : {};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...chromeLaunchOptions } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
