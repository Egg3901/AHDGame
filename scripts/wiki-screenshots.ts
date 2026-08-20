/**
 * Wiki guide screenshot harness.
 *
 * Captures 1280px-wide PNGs of core game screens for the player wiki
 * (public/wiki-images/guides/<name>.png). Wiki pages embed them via the
 * `guide-screenshot` widget; missing files render as nothing, not a broken image.
 *
 * Do NOT point this at a live production site. Use a local or staging
 * instance you control.
 *
 * Required env:
 *   BASE_URL              Origin to open, e.g. http://localhost:3000
 *   SCREENSHOT_EMAIL      Account that already has a character
 *   SCREENSHOT_PASSWORD   Password for that account
 *
 * Optional:
 *   SCREENSHOT_OUT        Output directory (default public/wiki-images/guides)
 *
 * Run: npm run wiki:screenshots
 *
 * Playwright is a devDependency (@playwright/test). Install browsers once with
 * `npx playwright install chromium` if Chromium is missing locally.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const VIEWPORT = { width: 1280, height: 800 } as const;

interface CaptureTarget {
  name: string;
  path: string;
}

/**
 * Declared capture list. Paths are same-origin routes after login.
 * `corporation` uses the corporations index so a specific corp id is not required.
 * `campaign` uses /campaign, which redirects to the caller's active campaign
 * when one exists (otherwise it still captures the campaign landing state).
 * `legislature` is the US Congress chamber; other countries use /country/.../legislature.
 */
const CAPTURE_TARGETS: readonly CaptureTarget[] = [
  { name: "dashboard", path: "/dashboard" },
  { name: "elections", path: "/elections" },
  { name: "corporation", path: "/corporations" },
  { name: "legislature", path: "/congress" },
  { name: "campaign", path: "/campaign" },
  { name: "map", path: "/map" },
];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing ${name}. Set BASE_URL, SCREENSHOT_EMAIL, and SCREENSHOT_PASSWORD. Do not run this against production.`
    );
  }
  return value;
}

async function main(): Promise<void> {
  const baseUrl = requiredEnv("BASE_URL").replace(/\/$/, "");
  const email = requiredEnv("SCREENSHOT_EMAIL");
  const password = requiredEnv("SCREENSHOT_PASSWORD");
  const outDir = path.resolve(process.env.SCREENSHOT_OUT?.trim() || "public/wiki-images/guides");

  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
    await page.getByLabel(/email or username/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

    for (const target of CAPTURE_TARGETS) {
      await page.goto(`${baseUrl}${target.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(750);
      const dest = path.join(outDir, `${target.name}.png`);
      await page.screenshot({ path: dest, fullPage: false, type: "png" });
      console.log(`wrote ${dest}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
