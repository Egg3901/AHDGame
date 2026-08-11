/**
 * Performance tests for heavy and commonly visited pages.
 * Measures wall-clock time from navigation start until main content is visible.
 * Run with: npm run test:e2e:performance (or `npm run test:e2e -- e2e/performance.spec.ts`)
 *
 * Requires dev server (npm run dev) or built app. Thresholds are tuned for CI;
 * local runs are typically faster.
 */
import { test, expect, type Page } from "@playwright/test";

/** Budgets: "heavy" = maps/globe/large SVG; "standard" = country + data dashboards; "fast" = lists */
const BUDGET = {
  heavy: 12_000,
  standard: 6_000,
  fast: 5_000,
} as const;

/**
 * Time from `goto` through `ready()` — use the same pattern as user-perceived load.
 */
async function timeUntilReady(
  page: Page,
  path: string,
  ready: () => Promise<void>
): Promise<number> {
  const start = performance.now();
  await page.goto(path);
  await ready();
  return performance.now() - start;
}

test.describe("Page load performance (public)", () => {
  test("home page loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/", async () => {
      await expect(page.getByText(/A House Divided/i).first()).toBeVisible({ timeout: 15_000 });
    });
    expect(ms).toBeLessThan(BUDGET.heavy);
  });

  test("map page loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/map", async () => {
      await expect(page).toHaveURL(/\/map/);
      await expect(
        page.getByText(/Party Organization|Political Lean|Government Approval|Loading/i)
      ).toBeVisible({ timeout: 15_000 });
    });
    expect(ms).toBeLessThan(BUDGET.heavy);
    await expect(page).toHaveScreenshot("map-page.png");
  });

  test("world page loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/world", async () => {
      await expect(page).toHaveURL(/\/world/);
      await expect(page.getByRole("heading", { name: /global politics/i })).toBeVisible({
        timeout: 15_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.heavy);
  });

  test("elections page loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/elections", async () => {
      await expect(page).toHaveURL(/\/country\/[a-z]{2}\/elections/i);
      await expect(page.getByRole("heading", { name: /elections/i })).toBeVisible({
        timeout: 10_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.fast);
  });

  test("congress page loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/congress", async () => {
      await expect(page).toHaveURL(/\/country\/[a-z]{2}\/legislature/i);
      await expect(page.getByText(/Majority Party/i).first()).toBeVisible({ timeout: 10_000 });
    });
    expect(ms).toBeLessThan(BUDGET.fast);
  });

  test("national metrics (via /national redirect) loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/national", async () => {
      await expect(page).toHaveURL(/\/country\/us\/metrics/i);
      await expect(page.getByRole("heading", { name: /national overview/i })).toBeVisible({
        timeout: 10_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.fast);
  });

  test("country overview (US) loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/country/US", async () => {
      await expect(page).toHaveURL(/\/country\/US/i);
      await expect(page.getByText(/United States/i).first()).toBeVisible({ timeout: 12_000 });
    });
    expect(ms).toBeLessThan(BUDGET.standard);
  });

  test("forex hub loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/forex/global", async () => {
      await expect(page.getByRole("heading", { name: /currency exchange/i })).toBeVisible({
        timeout: 12_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.standard);
  });

  test("stock market (US) loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/country/US/stockmarket", async () => {
      await expect(page).toHaveURL(/\/country\/US\/stockmarket/i);
      await expect(page.getByRole("heading", { name: /stock market/i })).toBeVisible({
        timeout: 12_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.standard);
  });

  test("central bank (US) loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/country/US/central-bank", async () => {
      await expect(page).toHaveURL(/\/country\/US\/central-bank/i);
      await expect(page.getByText(/Prime Rate/i).first()).toBeVisible({ timeout: 12_000 });
    });
    expect(ms).toBeLessThan(BUDGET.standard);
  });

  test("wiki index loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/wiki", async () => {
      await expect(page).toHaveURL(/\/wiki/);
      await expect(page.getByRole("heading", { name: /game wiki/i })).toBeVisible({
        timeout: 12_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.standard);
  });

  test("news page loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/news", async () => {
      await expect(page).toHaveURL(/\/news/);
      await expect(page.getByRole("heading", { name: /news & events/i })).toBeVisible({
        timeout: 10_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.fast);
  });

  test("officials page loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/officials", async () => {
      await expect(page).toHaveURL(/\/officials/);
      await expect(page.getByRole("heading", { name: /officials & vacancies/i })).toBeVisible({
        timeout: 12_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.fast);
  });

  test("parties directory loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/country/US/parties", async () => {
      await expect(page).toHaveURL(/\/country\/US\/parties/i);
      await expect(page.getByRole("heading", { name: /political parties/i })).toBeVisible({
        timeout: 12_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.fast);
  });

  test("commodity detail loads within threshold", async ({ page }) => {
    const ms = await timeUntilReady(page, "/commodity/steel", async () => {
      await expect(page).toHaveURL(/\/commodity\/steel/i);
      await expect(page.getByText(/steel & metals/i).first()).toBeVisible({ timeout: 12_000 });
    });
    expect(ms).toBeLessThan(BUDGET.standard);
  });
});

test.describe("Navigation Timing API (sanity)", () => {
  test("country overview exposes finite NavigationTiming duration", async ({ page }) => {
    await page.goto("/country/US");
    await expect(page.locator("body")).toBeVisible({ timeout: 12_000 });

    const durationMs = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      return entry?.duration ?? null;
    });

    expect(durationMs).not.toBeNull();
    expect(durationMs!).toBeGreaterThan(0);
    expect(durationMs!).toBeLessThan(45_000);
  });

  test("map route exposes finite NavigationTiming duration", async ({ page }) => {
    await page.goto("/map");
    await expect(
      page.getByText(/Party Organization|Political Lean|Government Approval|Loading/i)
    ).toBeVisible({ timeout: 15_000 });

    const durationMs = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      return entry?.duration ?? null;
    });

    expect(durationMs).not.toBeNull();
    expect(durationMs!).toBeGreaterThan(0);
    expect(durationMs!).toBeLessThan(60_000);
  });
});

test.describe("Authenticated performance", () => {
  test("portfolio loads within threshold after login", async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;
    if (!email || !password) {
      test.skip(
        true,
        "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in .env.local for portfolio performance test"
      );
      return;
    }

    await page.goto("/login");
    await page.getByLabel(/email or username/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    const ms = await timeUntilReady(page, "/portfolio", async () => {
      await expect(page).toHaveURL(/\/portfolio/);
      await expect(page.getByRole("heading", { name: /portfolio & wallet/i })).toBeVisible({
        timeout: 20_000,
      });
    });
    expect(ms).toBeLessThan(BUDGET.standard);
  });
});
