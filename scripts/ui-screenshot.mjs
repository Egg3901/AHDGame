// Capture one or more app routes across a theme × viewport matrix, for UI
//
//   node scripts/ui-screenshot.mjs <route...> [--themes a,b] [--viewports WxH,...]
//        [--out dir] [--base url] [--storage-state file]
//
// Defaults: themes default,light,oled,broadsheet · viewports 375x812,768x1024,1440x900
// · out tmp/screenshots · base $PLAYWRIGHT_BASE_URL or http://localhost:3000.
// Requires the dev server to already be running — this never starts one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { parseThemes } from "./build-design-md.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Derived from the token SSOT so a new theme is valid here automatically.
const VALID_THEMES = [
  ...parseThemes(
    fs.readFileSync(path.join(ROOT, "src", "app", "globals.css"), "utf8")
  ).themes.keys(),
];

function usage(msg) {
  console.error(
    `${msg}\n\nUsage: node scripts/ui-screenshot.mjs <route...> [--themes a,b] [--viewports WxH,...] [--out dir] [--base url] [--storage-state file]`
  );
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    routes: [],
    themes: ["default", "light", "oled", "broadsheet"],
    viewports: ["375x812", "768x1024", "1440x900"],
    out: path.join(ROOT, "tmp", "screenshots"),
    base: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    storageState: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--themes") opts.themes = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--viewports") opts.viewports = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--out") opts.out = path.resolve(argv[++i] ?? "");
    else if (a === "--base") opts.base = argv[++i];
    else if (a === "--storage-state") opts.storageState = path.resolve(argv[++i] ?? "");
    else if (a.startsWith("--")) usage(`Unknown option: ${a}`);
    else opts.routes.push(a);
  }
  if (opts.routes.length === 0) usage("No routes given.");
  for (const r of opts.routes) {
    // Git Bash (MSYS) rewrites "/route" args into "C:/Program Files/Git/route".
    if (/^[A-Za-z]:[\\/]/.test(r)) {
      usage(
        `Route "${r}" looks like a Windows path — Git Bash path conversion mangled it. Re-run with MSYS_NO_PATHCONV=1, or from PowerShell/cmd.`
      );
    }
  }
  for (const t of opts.themes) {
    if (!VALID_THEMES.includes(t)) usage(`Unknown theme "${t}". Valid: ${VALID_THEMES.join(", ")}`);
  }
  for (const v of opts.viewports) {
    if (!/^\d+x\d+$/.test(v)) usage(`Malformed viewport "${v}" (expected WxH, e.g. 1440x900).`);
  }
  return opts;
}

const slug = (route) => route.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "home";

async function assertServerUp(base) {
  try {
    await fetch(base, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.error(
      `Cannot reach ${base} — start the dev server first (npm run dev), or pass --base.`
    );
    process.exit(1);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await assertServerUp(opts.base);
  fs.mkdirSync(opts.out, { recursive: true });

  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const theme of opts.themes) {
      for (const vp of opts.viewports) {
        const [width, height] = vp.split("x").map(Number);
        const context = await browser.newContext({
          viewport: { width, height },
          ...(opts.storageState ? { storageState: opts.storageState } : {}),
        });
        // Set the persisted theme before any page script runs (ThemeContext
        // reads localStorage "ahd-theme"), then hard-set the attribute too in
        // case the route skips the provider.
        await context.addInitScript((t) => {
          try {
            localStorage.setItem("ahd-theme", t);
          } catch {
            /* storage unavailable — attribute fallback below still applies */
          }
        }, theme);
        const page = await context.newPage();
        for (const route of opts.routes) {
          const url = new URL(route, opts.base).toString();
          const file = path.join(opts.out, `${slug(route)}__${theme}__${vp}.png`);
          try {
            await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
            await page.evaluate(
              (t) => document.documentElement.setAttribute("data-theme", t),
              theme
            );
            await page.waitForTimeout(300);
            await page.screenshot({ path: file, fullPage: true });
            console.log(`✓ ${path.relative(ROOT, file)}`);
          } catch (err) {
            failures.push(`${route} @ ${theme}/${vp}: ${err.message.split("\n")[0]}`);
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} capture(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
