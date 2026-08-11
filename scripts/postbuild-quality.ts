/**
 * Post-build quality assessment script.
 * Runs after `next build`, collects quality metrics, computes scores,
 * and POSTs a CodeQualitySnapshot to the admin API.
 *
 * **Opt-in:** Set RUN_QUALITY_CHECK=true to enable. Skips silently otherwise.
 * Configure per-environment in Vercel project settings or .env.local.
 *
 * Environment detection:
 * - VERCEL_ENV=production → "production"
 * - VERCEL_ENV=preview → "staging"
 * - No VERCEL env → "localhost"
 *
 * Authenticates via INTERNAL_API_KEY (same env var used by requireAdminOrApiKey).
 */

// Opt-in gate — skip entirely unless explicitly enabled
if (process.env.RUN_QUALITY_CHECK !== "true") {
  console.log("[Quality] Skipped — set RUN_QUALITY_CHECK=true to enable.");
  process.exit(0);
}

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── Environment detection ───────────────────────────────────────────────────

function getEnvironment(): "localhost" | "staging" | "production" {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "staging";
  return "localhost";
}

function getGitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function getGitBranch(): string {
  if (process.env.VERCEL_GIT_COMMIT_REF) return process.env.VERCEL_GIT_COMMIT_REF;
  try {
    return execSync("git branch --show-current", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

// ─── Quality checks ─────────────────────────────────────────────────────────

function runLintCheck(): {
  errorCount: number;
  warningCount: number;
  byRule: Record<string, number>;
} {
  try {
    const output = execSync(
      "node_modules/.bin/eslint src/ --format json --no-error-on-unmatched-pattern",
      {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    const results = JSON.parse(output) as Array<{
      errorCount: number;
      warningCount: number;
      messages: Array<{ ruleId: string | null }>;
    }>;
    let errorCount = 0;
    let warningCount = 0;
    const byRule: Record<string, number> = {};
    for (const file of results) {
      errorCount += file.errorCount;
      warningCount += file.warningCount;
      for (const msg of file.messages) {
        if (msg.ruleId) {
          byRule[msg.ruleId] = (byRule[msg.ruleId] || 0) + 1;
        }
      }
    }
    return { errorCount, warningCount, byRule };
  } catch {
    console.warn("[Quality] Lint check failed, scoring 0");
    return { errorCount: 999, warningCount: 0, byRule: {} };
  }
}

function runTypeCheck(): { errorCount: number } {
  try {
    execSync("node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit", {
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
    });
    return { errorCount: 0 };
  } catch (err) {
    // tsc writes the "Found N errors" summary to stdout, but individual errors to stderr.
    // Check both streams for the summary line.
    const stdout = (err as { stdout?: string }).stdout || "";
    const stderr = (err as { stderr?: string }).stderr || "";
    const combined = stdout + "\n" + stderr;
    const matches = combined.match(/Found (\d+) errors?/);
    return { errorCount: matches ? parseInt(matches[1], 10) : 1 };
  }
}

function runTestCheck(): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  coveragePercent: number;
} {
  const resultsPath = path.join(os.tmpdir(), `ahd-quality-vitest-${process.pid}.json`);
  let commandFailed = false;
  try {
    execSync(
      `node_modules/.bin/vitest run --reporter=json --outputFile=${resultsPath} --coverage`,
      {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch {
    commandFailed = true;
  }

  try {
    const raw = fs.readFileSync(resultsPath, "utf8");
    const results = JSON.parse(raw);
    const total = results.numTotalTests ?? 0;
    const passed = results.numPassedTests ?? 0;
    const failed = results.numFailedTests ?? 0;
    const skipped = (results.numPendingTests ?? 0) + (results.numTodoTests ?? 0);

    let coveragePercent = 0;
    const coveragePath = path.join("coverage", "coverage-summary.json");
    if (fs.existsSync(coveragePath)) {
      const coverage = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
      coveragePercent = coverage.total?.lines?.pct ?? 0;
    }

    if (commandFailed) {
      console.warn(`[Quality] Test check completed with ${failed} failed test(s)`);
    }
    return { total, passed, failed, skipped, coveragePercent };
  } catch {
    console.warn("[Quality] Test result collection failed, scoring 0");
    return { total: 0, passed: 0, failed: 0, skipped: 0, coveragePercent: 0 };
  } finally {
    try {
      fs.unlinkSync(resultsPath);
    } catch {
      /* ignore cleanup error */
    }
  }
}

function runFormatCheck(): { violationCount: number } {
  try {
    const output = execSync("node_modules/.bin/prettier --list-different . --ignore-unknown", {
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
    });
    const files = output.trim().split("\n").filter(Boolean);
    return { violationCount: files.length };
  } catch (err) {
    // prettier --check exits with code 1 if violations found
    const output = (err as { stdout?: string }).stdout || "";
    const files = output.trim().split("\n").filter(Boolean);
    return { violationCount: files.length };
  }
}

function getBundleInfo(): {
  buildSuccess: boolean;
  totalSizeBytes: number;
  mobileSizeBytes: number;
  pageSizes: Record<string, number>;
} {
  try {
    const manifestPath = path.join(".next", "build-manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return { buildSuccess: false, totalSizeBytes: 0, mobileSizeBytes: 0, pageSizes: {} };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const commonFiles = [
      ...(manifest.rootMainFiles || []),
      ...(manifest.polyfillFiles || []),
      ...(manifest.lowPriorityFiles || []),
    ] as string[];
    const commonSize = [...new Set(commonFiles)].reduce((sum, file) => {
      const filePath = path.join(".next", file);
      return sum + (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
    }, 0);
    const pageSizes: Record<string, number> = { "common-client": commonSize };

    return {
      buildSuccess: true,
      totalSizeBytes: commonSize,
      mobileSizeBytes: commonSize,
      pageSizes,
    };
  } catch {
    return { buildSuccess: false, totalSizeBytes: 0, mobileSizeBytes: 0, pageSizes: {} };
  }
}

function runDependencyCheck(): {
  outdatedCount: number;
  vulnerabilities: { critical: number; high: number; moderate: number; low: number };
} {
  let vulnerabilities = { critical: 0, high: 0, moderate: 0, low: 0 };
  let outdatedCount = 0;

  try {
    const auditOutput = execSync("npm audit --json", {
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
    });
    const audit = JSON.parse(auditOutput);
    const vulns = audit.metadata?.vulnerabilities || {};
    vulnerabilities = {
      critical: vulns.critical || 0,
      high: vulns.high || 0,
      moderate: vulns.moderate || 0,
      low: vulns.low || 0,
    };
  } catch (err) {
    try {
      const output = (err as { stdout?: string }).stdout || "{}";
      const audit = JSON.parse(output);
      const vulns = audit.metadata?.vulnerabilities || {};
      vulnerabilities = {
        critical: vulns.critical || 0,
        high: vulns.high || 0,
        moderate: vulns.moderate || 0,
        low: vulns.low || 0,
      };
    } catch {
      /* ignore parse error */
    }
  }

  try {
    execSync("npm outdated --json", { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
    // If npm outdated exits 0, nothing is outdated
    outdatedCount = 0;
  } catch (err) {
    try {
      const output = (err as { stdout?: string }).stdout || "{}";
      const outdated = JSON.parse(output);
      outdatedCount = Object.keys(outdated).length;
    } catch {
      /* ignore */
    }
  }

  return { outdatedCount, vulnerabilities };
}

// ─── Score calculation ──────────────────────────────────────────────────────

function calcOverallScore(metrics: {
  lint: { errorCount: number; warningCount: number };
  typescript: { errorCount: number };
  tests: { total: number; passed: number; coveragePercent: number };
  format: { violationCount: number };
  bundle: { buildSuccess: boolean; totalSizeBytes: number };
  dependencies: {
    outdatedCount: number;
    vulnerabilities: { critical: number; high: number; moderate: number };
  };
}): number {
  const tsScore = Math.max(0, 100 - metrics.typescript.errorCount * 10);
  const passRate = metrics.tests.total > 0 ? metrics.tests.passed / metrics.tests.total : 1;
  const testScore = passRate * 60 + metrics.tests.coveragePercent * 0.4;
  const lintScore = Math.max(0, 100 - metrics.lint.errorCount * 5 - metrics.lint.warningCount);
  const formatScore = Math.max(0, 100 - metrics.format.violationCount * 3);
  const bundleKb = metrics.bundle.totalSizeBytes / 1024;
  // Grace budget calibrated to the measured common-client payload at the
  // metric change (575KB uncompressed, 2026-08-06 1.0 RC build). The old
  // 500KB budget was tuned for the per-page sums this script no longer
  // reports (manifest.pages is empty under the App Router, so the old metric
  // always read 0 and the score was vacuously 100).
  const bundleScore = metrics.bundle.buildSuccess
    ? Math.max(0, 100 - Math.max(0, bundleKb - 600) / 10)
    : 0;
  const depsScore = Math.max(
    0,
    100 -
      metrics.dependencies.vulnerabilities.critical * 25 -
      metrics.dependencies.vulnerabilities.high * 10 -
      metrics.dependencies.vulnerabilities.moderate * 3 -
      metrics.dependencies.outdatedCount
  );

  return (
    tsScore * 0.25 +
    testScore * 0.25 +
    lintScore * 0.2 +
    formatScore * 0.1 +
    bundleScore * 0.1 +
    depsScore * 0.1
  );
}

// ─── Mobile sub-score helpers ───────────────────────────────────────────────

/** Recursively find all .tsx/.ts files in a directory. */
function findSourceFiles(dir: string, ext = [".tsx", ".ts"]): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".next") {
        results.push(...findSourceFiles(full, ext));
      } else if (ext.some((e) => entry.name.endsWith(e))) {
        results.push(full);
      }
    }
  } catch {
    /* ignore unreadable dirs */
  }
  return results;
}

/** Read file content, returning empty string on error. */
function safeRead(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Resolve direct imports from a file and return their paths.
 * Handles `import ... from "@/components/..."` and relative imports.
 * Does NOT recurse into transitive imports — one level deep is sufficient.
 */
function resolveDirectImports(filePath: string, content: string): string[] {
  const importPaths: string[] = [];
  // Match: import ... from "..." or import ... from '...'
  const importRegex = /from\s+["'](@\/[^"']+|\.\.?\/[^"']+)["']/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    let importPath = match[1];
    // Resolve @/ alias to src/
    if (importPath.startsWith("@/")) {
      importPath = path.join("src", importPath.slice(2));
    } else {
      importPath = path.resolve(path.dirname(filePath), importPath);
    }
    // Try .tsx, .ts extensions
    for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      const candidate = importPath.endsWith(ext) ? importPath : importPath + ext;
      if (fs.existsSync(candidate)) {
        importPaths.push(candidate);
        break;
      }
    }
  }
  return importPaths;
}

const RESPONSIVE_PATTERN = /\b(sm|md|lg|xl|2xl):/;
const INTERACTIVE_ELEMENTS = /<(button|a\s|input|select|textarea)\b/gi;
const TOUCH_SIZE_CLASSES =
  /\b(min-h-\[44px\]|min-h-\[48px\]|h-11|h-12|h-14|p-3|p-4|py-3|py-4|px-4|px-6)\b/g;
const ARIA_PATTERN = /\baria-\w+\s*=/g;
const ALT_PATTERN = /\balt\s*=/g;
const SEMANTIC_HTML = /<(nav|main|header|footer|section|article|aside|figure)\b/gi;
const ROLE_PATTERN = /\brole\s*=/g;

/**
 * Responsive Coverage: % of page routes that use responsive breakpoints.
 * Checks the page file + its direct component imports for Tailwind responsive classes.
 */
function checkResponsiveCoverage(): number {
  const pageFiles = findSourceFiles(path.join("src", "app")).filter((f) => f.endsWith("page.tsx"));
  if (pageFiles.length === 0) return 100;

  let responsivePages = 0;

  for (const pageFile of pageFiles) {
    const pageContent = safeRead(pageFile);
    // Check page itself
    if (RESPONSIVE_PATTERN.test(pageContent)) {
      responsivePages++;
      continue;
    }
    // Check direct imports (one level deep)
    const imports = resolveDirectImports(pageFile, pageContent);
    let found = false;
    for (const imp of imports) {
      if (RESPONSIVE_PATTERN.test(safeRead(imp))) {
        found = true;
        break;
      }
    }
    if (found) responsivePages++;
  }

  return (responsivePages / pageFiles.length) * 100;
}

/**
 * Touch Target Compliance: % of interactive elements that have adequate sizing.
 * Scans all component files for buttons/links/inputs and checks for touch-friendly classes.
 */
function checkTouchTargetCompliance(): number {
  // Reset shared global regexes to avoid stale lastIndex from prior function calls
  INTERACTIVE_ELEMENTS.lastIndex = 0;
  TOUCH_SIZE_CLASSES.lastIndex = 0;

  const componentFiles = findSourceFiles(path.join("src", "components"));
  const pageFiles = findSourceFiles(path.join("src", "app")).filter((f) => f.endsWith("page.tsx"));
  const allFiles = [...componentFiles, ...pageFiles];

  let totalInteractive = 0;
  let withTouchSize = 0;

  for (const file of allFiles) {
    const content = safeRead(file);

    // Count interactive elements
    const interactiveMatches = content.match(INTERACTIVE_ELEMENTS);
    if (!interactiveMatches) continue;

    totalInteractive += interactiveMatches.length;

    // Count touch-sized elements: interactive elements near a sizing class.
    // Heuristic: split file into chunks around each interactive element and check
    // if a sizing class appears within ~200 chars (same JSX element context).
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (INTERACTIVE_ELEMENTS.test(lines[i])) {
        // Check a window of ±3 lines around the element for sizing classes
        const context = lines.slice(Math.max(0, i - 1), i + 4).join(" ");
        if (TOUCH_SIZE_CLASSES.test(context)) {
          withTouchSize++;
        }
        // Reset lastIndex since we're reusing the regex
        INTERACTIVE_ELEMENTS.lastIndex = 0;
        TOUCH_SIZE_CLASSES.lastIndex = 0;
      }
    }
  }

  if (totalInteractive === 0) return 100;
  return (withTouchSize / totalInteractive) * 100;
}

/**
 * Accessibility Score: ratio of a11y markers to interactive elements.
 * Counts aria-* attributes, alt tags, semantic HTML, and role attributes.
 */
function checkAccessibility(): number {
  // Reset shared global regexes to avoid stale lastIndex from prior function calls
  INTERACTIVE_ELEMENTS.lastIndex = 0;
  ARIA_PATTERN.lastIndex = 0;
  ALT_PATTERN.lastIndex = 0;
  SEMANTIC_HTML.lastIndex = 0;
  ROLE_PATTERN.lastIndex = 0;

  const allFiles = findSourceFiles("src");

  let totalInteractive = 0;
  let a11yMarkers = 0;

  for (const file of allFiles) {
    const content = safeRead(file);

    const interactive = content.match(INTERACTIVE_ELEMENTS);
    if (interactive) totalInteractive += interactive.length;

    const ariaCount = content.match(ARIA_PATTERN)?.length ?? 0;
    const altCount = content.match(ALT_PATTERN)?.length ?? 0;
    const semanticCount = content.match(SEMANTIC_HTML)?.length ?? 0;
    const roleCount = content.match(ROLE_PATTERN)?.length ?? 0;

    a11yMarkers += ariaCount + altCount + semanticCount + roleCount;

    // Reset global regex lastIndex
    INTERACTIVE_ELEMENTS.lastIndex = 0;
    SEMANTIC_HTML.lastIndex = 0;
  }

  if (totalInteractive === 0) return 100;
  // Score: ratio of a11y markers to interactive elements, capped at 100
  // A well-accessible page typically has 1-2 markers per interactive element
  return Math.min(100, (a11yMarkers / totalInteractive) * 50);
}

/** Viewport meta tag check — binary score. */
function checkViewport(): number {
  try {
    const layoutPath = path.join("src", "app", "layout.tsx");
    if (fs.existsSync(layoutPath)) {
      const content = fs.readFileSync(layoutPath, "utf8");
      return content.includes("viewport") ? 100 : 0;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

interface MobileSubScores {
  bundleScore: number;
  responsiveCoverage: number;
  touchTargetCompliance: number;
  accessibility: number;
  viewport: number;
}

function calcMobileScore(bundle: { mobileSizeBytes: number }): {
  score: number;
  subScores: MobileSubScores;
} {
  const mobileKb = bundle.mobileSizeBytes / 1024;
  // mobileSizeBytes now reports the same common-client payload as the overall
  // bundle metric (the old admin-route exclusion applied to per-page sums that
  // always read 0 under the App Router), so it shares the same 600KB grace
  // budget - the old 300KB budget would flat-tax every build ~55 points for
  // the metric change alone.
  const bundleScore = Math.max(0, 100 - Math.max(0, mobileKb - 600) / 5);

  const responsiveCoverage = checkResponsiveCoverage();
  const touchTargetCompliance = checkTouchTargetCompliance();
  const accessibility = checkAccessibility();
  const viewport = checkViewport();

  // Weighted per spec: bundle 35%, responsive 25%, touch 15%, a11y 15%, viewport 10%
  const score =
    bundleScore * 0.35 +
    responsiveCoverage * 0.25 +
    touchTargetCompliance * 0.15 +
    accessibility * 0.15 +
    viewport * 0.1;

  return {
    score,
    subScores: { bundleScore, responsiveCoverage, touchTargetCompliance, accessibility, viewport },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("[Quality] Starting post-build quality assessment...");

  const environment = getEnvironment();
  const gitSha = getGitSha();
  const gitBranch = getGitBranch();

  console.log(
    `[Quality] Environment: ${environment}, SHA: ${gitSha.slice(0, 7)}, Branch: ${gitBranch}`
  );

  console.log("[Quality] Running lint check...");
  const lint = runLintCheck();

  console.log("[Quality] Running type check...");
  const typescript = runTypeCheck();

  console.log("[Quality] Running test check...");
  const tests = runTestCheck();

  console.log("[Quality] Running format check...");
  const format = runFormatCheck();

  console.log("[Quality] Analyzing bundle...");
  const bundle = getBundleInfo();

  console.log("[Quality] Checking dependencies...");
  const dependencies = runDependencyCheck();

  const overallScore = calcOverallScore({ lint, typescript, tests, format, bundle, dependencies });

  console.log("[Quality] Running mobile quality checks...");
  const { score: mobileScore, subScores } = calcMobileScore(bundle);

  console.log(`[Quality] Overall: ${overallScore.toFixed(1)}, Mobile: ${mobileScore.toFixed(1)}`);
  console.log(
    `[Quality] Mobile sub-scores: Bundle=${subScores.bundleScore.toFixed(0)}, ` +
      `Responsive=${subScores.responsiveCoverage.toFixed(0)}, ` +
      `Touch=${subScores.touchTargetCompliance.toFixed(0)}, ` +
      `A11y=${subScores.accessibility.toFixed(0)}, ` +
      `Viewport=${subScores.viewport}`
  );

  const gateFailures: string[] = [];
  if (lint.errorCount > 0) gateFailures.push(`${lint.errorCount} lint error(s)`);
  if (typescript.errorCount > 0) {
    gateFailures.push(`${typescript.errorCount} TypeScript error(s)`);
  }
  if (tests.total === 0) gateFailures.push("test or coverage collection failed");
  if (tests.failed > 0) gateFailures.push(`${tests.failed} failed test(s)`);
  if (format.violationCount > 0) {
    gateFailures.push(`${format.violationCount} formatting violation(s)`);
  }
  if (!bundle.buildSuccess) gateFailures.push("production bundle missing");

  // POST to API
  const apiUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const apiKey = process.env.INTERNAL_API_KEY;

  if (!apiKey) {
    console.warn("[Quality] INTERNAL_API_KEY not set — skipping API upload. Results:");
    console.log(
      JSON.stringify(
        { overallScore, mobileScore, lint, typescript, tests, format, bundle, dependencies },
        null,
        2
      )
    );
    if (gateFailures.length > 0) {
      console.error(`[Quality] Gate failed: ${gateFailures.join(", ")}`);
      process.exitCode = 1;
    }
    return;
  }

  const payload = {
    environment,
    gitSha,
    gitBranch,
    overallScore: Math.round(overallScore * 10) / 10,
    mobileScore: Math.round(mobileScore * 10) / 10,
    lint,
    typescript,
    tests,
    format,
    bundle,
    dependencies,
  };

  try {
    const res = await fetch(`${apiUrl}/api/admin/code-quality/snapshots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      console.log("[Quality] Snapshot uploaded successfully.");
    } else {
      console.warn(`[Quality] Upload failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn("[Quality] Upload failed:", err);
  }

  if (gateFailures.length > 0) {
    console.error(`[Quality] Gate failed: ${gateFailures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
