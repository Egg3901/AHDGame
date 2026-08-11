import path from "path";
import { config as dotenvConfig } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// Load .env.local for E2E_TEST_EMAIL, E2E_TEST_PASSWORD
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local") });

/**
 * Playwright E2E config for A House Divided.
 * Run with: npm run test:e2e
 * Requires dev server: npm run dev (or npm run start after build)
 *
 * For login tests, set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in .env.local
 * (use a seeded user with a character for full flow coverage).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "[REDACTED]",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.CI
    ? {
        command: "npm run build && npm run start",
        url: "[REDACTED]",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
