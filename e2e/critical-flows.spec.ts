import { test, expect } from "@playwright/test";

test.describe("Critical flows", () => {
  test("view elections list", async ({ page }) => {
    await page.goto("/elections");
    await expect(page).toHaveURL(/\/elections/);
    await expect(page.getByRole("heading", { name: /elections/i })).toBeVisible({
      timeout: 10_000,
    });
    // Page shows elections content, empty state, or login prompt
    await expect(page.locator("body")).toContainText(
      /elections|no elections found|loading|to participate in elections/i
    );
    await expect(page).toHaveScreenshot("elections-list.png");
  });

  test("view congress bills", async ({ page }) => {
    await page.goto("/congress");
    await expect(page).toHaveURL(/\/congress/);
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    // Congress page shows Composition, Bills, or chamber content
    await expect(page.locator("body")).toContainText(/composition|bills|senate|house|congress/i);
    const billsLink = page.getByRole("link", { name: /bills/i });
    if (await billsLink.isVisible()) {
      await billsLink.click();
      await expect(page).toHaveURL(/\/congress/);
    }
  });

  test("logged-in: view dashboard after login", async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;
    if (!email || !password) {
      test.skip(true, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in .env.local to run login tests");
      return;
    }

    await page.goto("/login");
    await page.getByLabel(/email or username/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

    // From dashboard, navigate to elections
    await page.goto("/elections");
    await expect(page).toHaveURL(/\/elections/);

    // From dashboard, navigate to congress
    await page.goto("/congress");
    await expect(page).toHaveURL(/\/congress/);
  });
});
