import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("home page loads and shows A House Divided", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=A House Divided").first()).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot("home-page.png");
  });

  test("login page loads and has sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByLabel(/email or username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page).toHaveScreenshot("login-page.png");
  });

  test("register page loads", async ({ page }) => {
    await page.goto("/register");
    await expect(
      page.getByRole("heading", { name: /create your political career|create account/i })
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot("register-page.png");
  });

  test("elections page loads (public)", async ({ page }) => {
    await page.goto("/elections");
    await expect(page).toHaveURL(/\/elections/);
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
  });

  test("congress page loads (public)", async ({ page }) => {
    await page.goto("/congress");
    await expect(page).toHaveURL(/\/congress/);
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
  });

  test("login → dashboard when credentials provided", async ({ page }) => {
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
    await expect(page.locator("body")).toContainText(/dashboard|welcome|actions|funds/i);
  });
});
