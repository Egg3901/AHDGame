#!/usr/bin/env node

/**
 * Architecture audit for enforced boundary rules and migration warnings.
 *
 * Blocking checks fail CI immediately.
 * Warning checks surface drift we want to pay down during the restructure.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {Object} Match
 * @property {string} file
 * @property {number} line
 * @property {string} content
 */

/**
 * @typedef {Object} Check
 * @property {"blocking" | "warning"} severity
 * @property {string} name
 * @property {RegExp} pattern
 * @property {string} searchPath
 * @property {RegExp[]} excludePatterns
 * @property {string} description
 */

/** @type {Check[]} */
const checks = [
  {
    severity: "blocking",
    name: "request.json() in API routes",
    pattern: /request\.json\(/,
    searchPath: "src/app/api",
    excludePatterns: [/\.test\.ts$/, /\.integration\.test\.ts$/, /\.spec\.ts$/],
    description: "Use parseJsonBody() from @/lib/api/validate instead of raw request.json().",
  },
  {
    severity: "blocking",
    name: "jwtVerify() outside auth modules",
    pattern: /jwtVerify\(/,
    searchPath: "src",
    excludePatterns: [
      /\.test\.ts$/,
      /\.integration\.test\.ts$/,
      /\.spec\.ts$/,
      /src[\\/]lib[\\/]auth\.ts$/,
      /src[\\/]app[\\/]api[\\/]auth[\\/]/,
      /src[\\/]proxy\.ts$/,
    ],
    description:
      "Use requireAuth() helpers from @/lib/api/requireAuth instead of manual jwtVerify().",
  },
  {
    severity: "blocking",
    name: "hardcoded DB credentials in src",
    // Matches connection strings carrying an embedded password (user:secret@host).
    // The negative lookahead skips ALL-CAPS placeholders (e.g. YOUR_PASSWORD@).
    pattern: /mongodb(?:\+srv)?:\/\/[^\s:'"@/]+:(?![A-Z_]+@)[^\s@'"]+@/,
    searchPath: "src",
    excludePatterns: [/\.test\.ts$/, /\.integration\.test\.ts$/, /\.spec\.ts$/],
    description:
      "Never commit DB credentials. Read connection strings from process.env (fail-fast if unset); see scripts/seed-sandbox.ts for the pattern.",
  },
  {
    severity: "blocking",
    name: "hardcoded DB credentials in scripts",
    pattern: /mongodb(?:\+srv)?:\/\/[^\s:'"@/]+:(?![A-Z_]+@)[^\s@'"]+@/,
    searchPath: "scripts",
    excludePatterns: [/\.test\.ts$/, /\.integration\.test\.ts$/, /\.spec\.ts$/],
    description:
      "Never commit DB credentials. Read connection strings from process.env (fail-fast if unset); see scripts/seed-sandbox.ts for the pattern.",
  },
  {
    severity: "blocking",
    name: "src/lib importing scripts",
    pattern: /from\s+['"](?:@\/scripts|\.\.\/scripts|\.\.\/\.\.\/scripts)/,
    searchPath: "src/lib",
    excludePatterns: [/\.test\.ts$/, /\.integration\.test\.ts$/, /\.spec\.ts$/],
    description: "Runtime code must not depend on build-time scripts or migration utilities.",
  },
  {
    severity: "blocking",
    name: "pure getGameState imports from turnSystem",
    pattern:
      /\b(?:import|export)\s*\{[^;]*?\bgetGameState\b[^;]*?\}\s*from\s*['"]@\/lib\/turnSystem['"]/g,
    searchPath: "src",
    excludePatterns: [/\.test\.ts$/, /\.integration\.test\.ts$/, /\.spec\.ts$/],
    description:
      "Shared state readers should import getGameState() from @/lib/gameState instead of the turn orchestrator.",
  },
  {
    severity: "warning",
    name: "src/lib importing src/app",
    pattern: /from\s+['"](?:@\/app\/|(?:\.\.\/)+app\/)/,
    searchPath: "src/lib",
    excludePatterns: [/\.test\.ts$/, /\.integration\.test\.ts$/, /\.spec\.ts$/],
    description:
      "Domain/runtime code should not depend on app-layer routes, pages, or app-owned types.",
  },
  {
    severity: "blocking",
    name: "app/components importing API route modules",
    pattern: /from\s+['"]@\/app\/api\//,
    searchPath: "src",
    excludePatterns: [
      /\.test\.ts$/,
      /\.integration\.test\.ts$/,
      /\.spec\.ts$/,
      /src[\\/]app[\\/]api[\\/]/,
    ],
    description:
      "Pages and components should not treat API route files as a shared contract surface. Move the response type to src/lib/<domain>/types.ts and import it from there.",
  },
  {
    severity: "warning",
    name: "non-API app/components importing turn internals",
    pattern: /from\s+['"]@\/lib\/turn(?:\/|['"])|from\s+['"]@\/lib\/turnSystem['"]/,
    searchPath: "src",
    excludePatterns: [
      /\.test\.ts$/,
      /\.integration\.test\.ts$/,
      /\.spec\.ts$/,
      /src[\\/]app[\\/]api[\\/]/,
      /src[\\/]lib[\\/]/,
      /src[\\/]simulation[\\/]/,
    ],
    description:
      "UI and delivery layers should consume domain/query surfaces instead of turn-engine internals.",
  },
];

// ---------------------------------------------------------------------------
// File-size cap rule
// ---------------------------------------------------------------------------
// Files in `src/` are tracked against two thresholds:
//   - SIZE_WARN_LOC: above this, surface a warning (decomposition imminent).
//   - SIZE_BLOCK_LOC: above this, fail the audit.
// SIZE_CAP_EXEMPT lists pure-data / generated files where size is acceptable.
// SIZE_CAP_ALLOWLIST grandfathers in currently-oversized files awaiting
// decomposition in later phases. Do not extend the allowlist for new code —
// add to SIZE_CAP_EXEMPT only for documented data files, with a comment.

const SIZE_WARN_LOC = 1200;
const SIZE_BLOCK_LOC = 2000;

const SIZE_CAP_EXEMPT = [
  // Pure-data seed files
  "src/lib/seeds/",
  // Pure-data constants (no logic, just declarative configuration tables)
  // Tech-tree early-fill node tables: declarative NodeSpec entries per sector,
  // zero functions or branches; consumed by buildTreeForSector.
  "src/lib/constants/techTree/earlySectorFill.ts",
  "src/lib/constants/usCabinetMechanics.ts",
  "src/lib/constants/ukCabinetMechanics.ts",
  "src/lib/constants/jpCabinetMechanics.ts",
  "src/lib/constants/cnCabinetMechanics.ts",
  "src/lib/constants/historicalSeats.ts",
  "src/lib/constants/metricDefinitions.ts",
  // The world alignment roster: one declarative row per entity (key, name, tier,
  // 1953 status, map feature ids, metropole) and no runtime logic. It grows by a
  // line whenever an entity gains geometry, which is data entry rather than a
  // decomposition signal — `alignmentRoster.test.ts` is what keeps it honest.
  "src/lib/constants/alignmentRoster.ts",
  // GENERATED demographic composition weights. The generator emits a typed,
  // reviewable table of numeric records with no runtime logic.
  "src/lib/demographics/compositionWeights.generated.ts",
  // Pure-data crisis/disaster template declarations (one object per template).
  "src/lib/crises/templates.ts",
  // Pure-data tech-tree node declarations (NodeSpec records, no logic).
  "src/lib/constants/techTree/nodes.ts",
  // Pure-data political-legislation catalogs (SP3): 109 authored laws per
  // country transcribed from the approved design docs — declarative
  // PoliticalLaw records only, validated by validate.ts, no logic.
  "src/lib/politicalLegislation/laws/usLaws.ts",
  "src/lib/politicalLegislation/laws/ukLaws.ts",
  "src/lib/politicalLegislation/laws/ruLaws.ts",
  "src/lib/politicalLegislation/laws/ddLaws.ts",
  // GENERATED pure-data political boards, emitted by
  // scripts/debug/derive-nonplayable-boards.ts --emit and committed so the
  // artifact is reviewable: 4 presets x 147 regions x 63 families of plain
  // numbers, no logic. Note this is `politicalMetrics/seeds/`, which the
  // `src/lib/seeds/` prefix above does NOT cover.
  "src/lib/politicalMetrics/seeds/",
];

// Files currently over the size threshold whose decomposition is tracked in
// the design doc (Phases 2/3/7).
// Do not add new entries here for new code — decompose first.
const SIZE_CAP_ALLOWLIST = new Set([
  // >2000 LOC (block tier)
  // Pure data: 476 authored tech-tree slot literals for decades 1940-1970, zero
  // functions. Decomposing it would split one table across files for no reader's
  // benefit, which is what the "documented data files" exemption is for. This
  // was blocking the whole architecture gate, so `npm run verify` failed for
  // everyone and stopped being run.
  "src/lib/constants/techTree/earlySectorFill.ts",
  "src/app/country/[code]/central-bank/CentralBankClient.tsx",
  "src/app/country/[code]/parties/[id]/components/CaucusesTab.tsx",
  "src/app/bond/[id]/page.tsx",
  // 1200–2000 LOC (warn tier)
  "src/lib/constants/countries.ts",
  "src/app/country/[code]/legislature/UKParliamentPage.tsx",
  "src/lib/constants/corporations.ts",
  "src/components/corporation/SectorsTab.tsx",
  "src/components/Navbar.tsx",
  "src/app/notifications/notificationConfig.tsx",
  "src/lib/turn/parliamentaryGovernment.ts",
  "src/lib/constants/commodities.ts",
  "src/lib/corporations/queries/corporationDetail.ts",
  "src/lib/turn/suspiciousDetection.ts",
  "src/lib/turn/perpetualElections.ts",
  "src/components/admin/economy/CorporationsAdminPanel.tsx",
  "src/components/admin/economy/CommoditiesAdminPanel.tsx",
]);

function isSizeExempt(filePath) {
  const norm = filePath.replace(/\\/g, "/");
  return SIZE_CAP_EXEMPT.some((suffix) => norm.includes(suffix));
}

function findSizeViolations() {
  const root = path.resolve(process.cwd(), "src");
  const files = walkDir(root);
  /** @type {{ file: string, loc: number }[]} */
  const block = [];
  /** @type {{ file: string, loc: number }[]} */
  const warn = [];
  for (const file of files) {
    if (isSizeExempt(file)) continue;
    if (/\.(test|integration\.test|spec)\.tsx?$/.test(file)) continue;
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    if (SIZE_CAP_ALLOWLIST.has(rel)) continue;
    const loc = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
    if (loc > SIZE_BLOCK_LOC) block.push({ file, loc });
    else if (loc > SIZE_WARN_LOC) warn.push({ file, loc });
  }
  return { block, warn };
}

// ---------------------------------------------------------------------------
// useState count rule
// ---------------------------------------------------------------------------
// Components with very high useState counts are unmaintainable; project
// convention is to switch to useReducer (model: src/components/officials/
// useOfficialsState.ts) past 5–6 useState calls. Threshold is intentionally
// permissive (15) so the rule names actively-broken cases without forcing a
// project-wide migration.

const USE_STATE_BLOCK_THRESHOLD = 15;

const USE_STATE_ALLOWLIST = new Set([
  // Phase-3 migration complete — no allowlisted files remain
]);

function findUseStateViolations() {
  const root = path.resolve(process.cwd(), "src");
  const files = walkDir(root).filter((f) => f.endsWith(".tsx"));
  /** @type {{ file: string, count: number }[]} */
  const violations = [];
  for (const file of files) {
    if (/\.(test|integration\.test|spec)\.tsx?$/.test(file)) continue;
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    if (USE_STATE_ALLOWLIST.has(rel)) continue;
    const text = fs.readFileSync(file, "utf8");
    // Count `useState(` not preceded by an identifier char (avoids `useStateMatch` etc.)
    const matches = text.match(/(?<![A-Za-z_0-9])useState\s*\(/g) || [];
    if (matches.length >= USE_STATE_BLOCK_THRESHOLD) {
      violations.push({ file, count: matches.length });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Auth-gated GET responses with a shared-CDN-cacheable header
// ---------------------------------------------------------------------------
// The CDN (Cloudflare) caches on URL and ignores the session cookie. A GET
// route handler that reads the caller's identity (an auth guard, session, or
// cookies()) and then returns a `public` / `s-maxage` Cache-Control header lets
// the edge store one user's response and serve it to the next caller of the
// same URL — a cross-user data leak (see the 2026-06-29 CDN cross-user exposure
// incident). Per-user responses must use `no-store` (or `private` for
// browser-only cache); a shared `s-maxage` is only safe when the payload is
// identical for every authorized caller.
//
// Scoped to the GET/HEAD handler specifically: pairing an auth read in POST
// with a cache header in GET (as in forex/exchange/route.ts, where GET is a
// public rates preview and POST is the per-user mutation) is NOT a leak, so a
// file-level check would false-positive. Only GET/HEAD are cached by the CDN.

const AUTH_READ_PATTERN =
  /\b(requireAuth|requireBasicAuth|requireAuthWithCharacter|requireHumanSession|requireHumanSessionWithCharacter|requireAdmin|requireAdminOrApiKey|requireModerator|requireForeignMinister|requireTradeMinister|requireUserApiKey|requireCeo|getSession|getServerSession)\b|\bcookies\s*\(\s*\)/;

// Captures the Cache-Control value from both the object-literal form
// (`"Cache-Control": "..."`) and the `.set("Cache-Control", "...")` form.
const CACHE_CONTROL_VALUE = /Cache-Control["']\s*[,:]\s*["']([^"']*)["']/gi;

/**
 * Extract the body text of the GET and HEAD handlers from a route module.
 * Handlers may be declared as `export async function GET(` or
 * `export const GET = `. Returns the concatenated GET/HEAD segments (each
 * running until the next handler export or end of file), or "" if none.
 * @param {string} content
 * @returns {string}
 */
function extractCacheableHandlerBodies(content) {
  const handlerStart =
    /export\s+(?:async\s+function|const|function)\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/g;
  /** @type {{ method: string, index: number }[]} */
  const handlers = [];
  let m;
  while ((m = handlerStart.exec(content)) !== null) {
    handlers.push({ method: m[1], index: m.index });
  }
  let out = "";
  for (let i = 0; i < handlers.length; i++) {
    if (handlers[i].method !== "GET" && handlers[i].method !== "HEAD") continue;
    const end = i + 1 < handlers.length ? handlers[i + 1].index : content.length;
    out += content.slice(handlers[i].index, end) + "\n";
  }
  return out;
}

/**
 * @returns {{ file: string, header: string }[]}
 */
function findUnsafeAuthCachedRoutes() {
  const apiRoot = path.resolve(process.cwd(), "src", "app", "api");
  const files = walkDir(apiRoot).filter(
    (f) => /[\\/]route\.tsx?$/.test(f) && !/\.(test|integration\.test|spec)\.tsx?$/.test(f)
  );
  /** @type {{ file: string, header: string }[]} */
  const violations = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const body = extractCacheableHandlerBodies(content);
    if (!body || !AUTH_READ_PATTERN.test(body)) continue;
    CACHE_CONTROL_VALUE.lastIndex = 0;
    let match;
    while ((match = CACHE_CONTROL_VALUE.exec(body)) !== null) {
      const value = match[1];
      const shared = /\b(public|s-maxage)\b/i.test(value);
      const guarded = /\b(no-store|private)\b/i.test(value);
      if (shared && !guarded) {
        violations.push({ file, header: value });
        break;
      }
    }
  }
  return violations;
}

/**
 * @param {string} filePath
 * @param {RegExp[]} excludePatterns
 */
// ---------------------------------------------------------------------------
// Portable rules core
// ---------------------------------------------------------------------------
// A system's rules (formulas, eligibility, resolution, state transitions) have
// to be able to run outside this server process. The hourly turn loop is one
// host for them, the headless harness in scripts/sim/ is another, and further
// hosts are planned. Running a system somewhere new must be a copy of the rules
// module, not a rewrite of it.
//
// The portable zone is `rules.ts` and any `rules/` directory under src/.
// Inside it: plain data in, plain data out, no ambient inputs. Randomness
// arrives as an injected rng, time arrives as the turn number or in-game date,
// the database stays with the caller. The shell (a turn phase or an API route)
// loads documents, calls the rules, and writes the results back.

const PORTABLE_ZONE = /(?:^|\/)rules(?:\/|\.tsx?$)/;

const PORTABLE_BANS = [
  {
    label: "database access",
    pattern:
      /\bdb\.collection[<(]|from\s+["'](?:mongodb|@\/lib\/mongodb|@\/lib\/db\/collections[^"']*)["']/,
    hint: "the caller loads and saves; rules take plain data and string ids",
  },
  {
    label: "wall clock",
    pattern: /new Date\(\s*\)|Date\.now\(/,
    hint: "take the turn number or the in-game date as a parameter",
  },
  {
    label: "ambient randomness",
    pattern: /Math\.random\(/,
    hint: "take a seeded rng as a parameter so the same inputs replay identically",
  },
  {
    label: "environment",
    pattern: /process\.env/,
    hint: "read config in the shell and pass it in",
  },
  {
    label: "network or telemetry",
    pattern: /\bfetch\(|from\s+["']@sentry\//,
    hint: "rules return what happened; the shell reports it",
  },
  {
    label: "app-layer import",
    pattern: /from\s+["']@\/app\//,
    hint: "rules cannot depend on routes, pages, or app-owned types",
  },
  {
    label: "asynchrony",
    pattern: /\bawait\s|\basync\s+function\b|\basync\s*\(/,
    hint: "pure rules resolve synchronously; anything worth awaiting belongs in the shell",
  },
];

function findPortabilityViolations() {
  const root = path.resolve(process.cwd(), "src");
  /** @type {{ file: string, line: number, label: string, hint: string, content: string }[]} */
  const violations = [];
  for (const file of walkDir(root)) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    if (!PORTABLE_ZONE.test(rel)) continue;
    if (/\.(test|integration\.test|spec)\.tsx?$/.test(rel)) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const ban of PORTABLE_BANS) {
        if (!ban.pattern.test(line)) continue;
        violations.push({
          file: rel,
          line: index + 1,
          label: ban.label,
          hint: ban.hint,
          content: line.trim(),
        });
      }
    });
  }
  return violations;
}

function isExcluded(filePath, excludePatterns) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return excludePatterns.some((pattern) => pattern.test(normalizedPath));
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkDir(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  /** @type {string[]} */
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
      continue;
    }

    if (entry.isFile() && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx"))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * @param {string} content
 * @param {number} index
 * @returns {number}
 */
function getLineNumberFromIndex(content, index) {
  return content.slice(0, index).split("\n").length;
}

/**
 * @param {Check} check
 * @returns {Match[]}
 */
function findMatches(check) {
  const searchDir = path.resolve(process.cwd(), check.searchPath);
  const files = walkDir(searchDir);
  /** @type {Match[]} */
  const matches = [];

  for (const file of files) {
    if (isExcluded(file, check.excludePatterns)) {
      continue;
    }

    const content = fs.readFileSync(file, "utf8");
    const flags = check.pattern.flags.includes("g")
      ? check.pattern.flags
      : `${check.pattern.flags}g`;
    const pattern = new RegExp(check.pattern.source, flags);
    let match;

    while ((match = pattern.exec(content)) !== null) {
      const matchText = match[0];
      const line = getLineNumberFromIndex(content, match.index);
      const contentPreview = matchText.split("\n")[0]?.trim() ?? "";

      matches.push({
        file,
        line,
        content: contentPreview,
      });

      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }
    }
  }

  return matches;
}

/**
 * @param {Match[]} matches
 */
function printMatches(matches) {
  const grouped = new Map();

  for (const match of matches) {
    const existing = grouped.get(match.file) ?? [];
    existing.push(match.line);
    grouped.set(match.file, existing);
  }

  for (const [file, lines] of grouped) {
    const relativePath = path.relative(process.cwd(), file);
    console.log(`   ${relativePath}:${lines.join(", ")}`);
  }
}

// ---- Client/server boundary rule ---------------------------------------
//
// A "use client" file that imports a module which (transitively) needs node
// built-ins puts that whole graph in the BROWSER bundle. `next build` fails,
// but nothing else does: tsc and vitest both resolve these imports happily,
// which is how the 1.1 line stayed unbuildable for two days across twenty
// failed deploys while every local gate reported green.
//
// The case that caused it: CentralBankReserveTab.tsx imported two numeric
// constants from `@/lib/banking/reserves`, which imports mongodb and reaches
// gdpAnchorRate, the turn engine, and finally `sharp`. Two numbers, 24 build
// errors.
//
// This walks the real import graph from every client entry point, so it catches
// the offence at any depth rather than only a direct import.

/**
 * Server-only modules that CANNOT be bundled for the browser at all: native
 * binaries and the like. Reaching one of these from a client component is a
 * guaranteed `next build` failure, so it blocks.
 */
const UNBUNDLEABLE_MODULES = new Set(["sharp", "canvas", "bcrypt", "sqlite3"]);

/** Modules that mean "this can only run on the server". */
const SERVER_ONLY_MODULES = new Set([
  "mongodb",
  "sharp",
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "net",
  "node:net",
  "tls",
  "node:tls",
  "dns",
  "node:dns",
  "child_process",
  "node:child_process",
  "async_hooks",
  "node:async_hooks",
  "timers/promises",
  "node:timers/promises",
  ...UNBUNDLEABLE_MODULES,
]);

// STATIC imports only. TypeScript's type-position `import("mongodb").ObjectId`
// is erased at build time but is indistinguishable from a dynamic import by
// regex, and dynamic imports are code-split anyway, so following them produced
// false positives without catching anything `next build` actually rejects.
const IMPORT_RE = /(?:^|\n)\s*import\s+(?:type\s+)?[^;]*?from\s*["']([^"']+)["']/g;

/** Imports of a file: [specifier, isTypeOnly]. Type imports are erased at build. */
function readImports(file) {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const m of content.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!spec) continue;
    const stmt = m[0];
    // `import type {...}` is erased before bundling and cannot pull anything in.
    out.push([spec, /\bimport\s+type\b/.test(stmt)]);
  }
  return out;
}

function resolveAlias(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(process.cwd(), "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  for (const idx of ["/index.ts", "/index.tsx"]) {
    if (fs.existsSync(base + idx)) return base + idx;
  }
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

/**
 * First path from `entry` to a server-only module, or null. Memoized across
 * entry points; the cache holds the offending chain so the message can name it.
 */
function findServerOnlyPath(entry, cache = new Map(), stack = new Set()) {
  if (cache.has(entry)) return cache.get(entry);
  if (stack.has(entry)) return null; // cycle
  stack.add(entry);

  let found = null;
  for (const [spec, isType] of readImports(entry)) {
    if (isType) continue;
    if (SERVER_ONLY_MODULES.has(spec)) {
      found = [entry, spec];
      break;
    }
    const next = resolveAlias(spec, entry);
    if (!next) continue;
    const deeper = findServerOnlyPath(next, cache, stack);
    if (deeper) {
      found = [entry, ...deeper];
      break;
    }
  }

  stack.delete(entry);
  cache.set(entry, found);
  return found;
}

function findClientServerViolations() {
  const roots = ["src/app", "src/components"].map((d) => path.join(process.cwd(), d));
  const violations = [];
  const cache = new Map();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walkDir(root)) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      if (/\.(test|spec)\.tsx?$/.test(file)) continue;
      let head;
      try {
        head = fs.readFileSync(file, "utf8").slice(0, 200);
      } catch {
        continue;
      }
      if (!/^\s*["']use client["']/m.test(head)) continue;
      const chain = findServerOnlyPath(file, cache);
      if (chain) violations.push({ file, chain });
    }
  }
  return violations;
}

function main() {
  console.log("Architecture Audit");
  console.log("=".repeat(60));
  console.log();

  let blockingCount = 0;
  let warningCount = 0;

  for (const severity of ["blocking", "warning"]) {
    const sectionChecks = checks.filter((check) => check.severity === severity);
    const title = severity === "blocking" ? "Blocking Checks" : "Migration Warnings";
    console.log(title);
    console.log("-".repeat(title.length));

    for (const check of sectionChecks) {
      const matches = findMatches(check);
      if (matches.length === 0) {
        console.log(`PASS ${check.name}`);
        continue;
      }

      console.log(`${severity === "blocking" ? "FAIL" : "WARN"} ${check.name} (${matches.length})`);
      console.log(`   ${check.description}`);
      printMatches(matches);
      console.log();

      if (severity === "blocking") {
        blockingCount += matches.length;
      } else {
        warningCount += matches.length;
      }
    }

    console.log();
  }

  // ---- Client/server boundary rule --------------------------------------
  //
  // Split by what `next build` actually does. Reaching a NATIVE module (sharp)
  // is a guaranteed build failure, so it blocks. Reaching mongodb or a node
  // built-in is a real boundary violation that the bundler currently tolerates,
  // so it warns: it is one dependency away from becoming the blocking kind, and
  // failing the build today for seven pre-existing cases would stop work
  // without preventing anything.
  const boundaryViolations = findClientServerViolations();
  const printChain = ({ file, chain }) => {
    console.log(`   ${path.relative(process.cwd(), file)}`);
    const pretty = chain.map((step) =>
      step.includes(path.sep) ? path.relative(process.cwd(), step) : step
    );
    console.log(`      ${pretty.join("\n      -> ")}`);
  };
  const fatal = boundaryViolations.filter((v) => UNBUNDLEABLE_MODULES.has(v.chain.at(-1)));
  const latent = boundaryViolations.filter((v) => !UNBUNDLEABLE_MODULES.has(v.chain.at(-1)));

  if (fatal.length > 0) {
    console.log(`FAIL client component reaches an unbundleable module (${fatal.length})`);
    console.log("   This fails `next build` and nothing else: tsc and vitest both resolve it.");
    console.log("   Move the value the client needs into a module with no server imports.");
    fatal.forEach(printChain);
    console.log();
    blockingCount += fatal.length;
  } else {
    console.log("PASS no client component reaches an unbundleable module");
  }
  if (latent.length > 0) {
    console.log(`WARN client component reaches a server-only module (${latent.length})`);
    console.log("   Tolerated by the bundler today. One native dependency away from fatal.");
    latent.forEach(printChain);
    console.log();
    warningCount += latent.length;
  }

  // ---- Size cap rule ----------------------------------------------------
  const sizeFindings = findSizeViolations();
  if (sizeFindings.block.length > 0) {
    console.log(`FAIL file size > ${SIZE_BLOCK_LOC} LOC (${sizeFindings.block.length})`);
    console.log("   Decompose. Add to SIZE_CAP_EXEMPT only for documented data files.");
    for (const { file, loc } of sizeFindings.block) {
      console.log(`   ${path.relative(process.cwd(), file)} (${loc} LOC)`);
    }
    console.log();
    blockingCount += sizeFindings.block.length;
  } else {
    console.log(`PASS file size <= ${SIZE_BLOCK_LOC} LOC`);
  }
  if (sizeFindings.warn.length > 0) {
    console.log(`WARN file size > ${SIZE_WARN_LOC} LOC (${sizeFindings.warn.length})`);
    console.log(`   Approaching the ${SIZE_BLOCK_LOC} LOC block threshold; plan a decomposition.`);
    for (const { file, loc } of sizeFindings.warn) {
      console.log(`   ${path.relative(process.cwd(), file)} (${loc} LOC)`);
    }
    console.log();
    warningCount += sizeFindings.warn.length;
  } else {
    console.log(`PASS file size <= ${SIZE_WARN_LOC} LOC`);
  }

  // ---- portable rules core ---------------------------------------------
  const portabilityViolations = findPortabilityViolations();
  if (portabilityViolations.length > 0) {
    console.log(`FAIL non-portable code in the rules zone (${portabilityViolations.length})`);
    console.log(
      "   `rules.ts` and `rules/**` hold logic that must run without this server: no database, no clock, no randomness, no environment, no network. Move the ambient input to the caller and pass it in."
    );
    for (const v of portabilityViolations) {
      console.log(`   ${v.file}:${v.line}  ${v.label}`);
      console.log(`      ${v.content}`);
      console.log(`      ${v.hint}`);
    }
    console.log();
    blockingCount += portabilityViolations.length;
  } else {
    console.log("PASS rules zone is portable (no database, clock, rng, env, or network)");
  }

  // ---- root middleware tripwire ----------------------------------------
  // A root-level middleware.(ts|js) silently shadows src/proxy.ts under
  // Turbopack (the both-conventions build check only scans src/), disabling
  // the API read-gate, maintenance gate, and x-pathname header injection.
  // The single interceptor must live in src/proxy.ts.
  const rootMiddleware = ["middleware.ts", "middleware.js", "middleware.mjs"].filter((f) =>
    fs.existsSync(path.join(process.cwd(), f))
  );
  if (rootMiddleware.length > 0) {
    console.log(`FAIL root middleware file present (${rootMiddleware.length})`);
    console.log(
      "   Root middleware.(ts|js) shadows src/proxy.ts under Turbopack. Merge its logic into src/proxy.ts and delete the root file."
    );
    for (const f of rootMiddleware) {
      console.log(`   ${f}`);
    }
    console.log();
    blockingCount += rootMiddleware.length;
  } else {
    console.log("PASS no root middleware file (src/proxy.ts is the sole interceptor)");
  }

  // ---- useState count rule ---------------------------------------------
  const stateViolations = findUseStateViolations();
  if (stateViolations.length > 0) {
    console.log(`FAIL useState count >= ${USE_STATE_BLOCK_THRESHOLD} (${stateViolations.length})`);
    console.log(
      "   Use useReducer for complex component state (model: src/components/officials/useOfficialsState.ts)."
    );
    for (const { file, count } of stateViolations) {
      console.log(`   ${path.relative(process.cwd(), file)} (${count} useState calls)`);
    }
    console.log();
    blockingCount += stateViolations.length;
  } else {
    console.log(`PASS useState count < ${USE_STATE_BLOCK_THRESHOLD}`);
  }

  // ---- auth-gated GET with shared-CDN cache header ---------------------
  const cacheLeaks = findUnsafeAuthCachedRoutes();
  if (cacheLeaks.length > 0) {
    console.log(`WARN auth-gated GET with shared-cache header (${cacheLeaks.length})`);
    console.log(
      "   GET reads the caller's identity and returns a public/s-maxage Cache-Control; the CDN ignores the session cookie and can serve one user's response to another. Use no-store (or private), or confirm the payload is identical for every authorized caller."
    );
    for (const { file, header } of cacheLeaks) {
      console.log(`   ${path.relative(process.cwd(), file)}  ("${header}")`);
    }
    console.log();
    warningCount += cacheLeaks.length;
  } else {
    console.log("PASS no auth-gated GET with shared-cache header");
  }

  console.log();
  console.log("Summary");
  console.log("-".repeat("Summary".length));
  console.log(`Blocking findings: ${blockingCount}`);
  console.log(`Warnings: ${warningCount}`);
  console.log();

  if (blockingCount > 0) {
    console.log("Blocking architecture checks failed.");
    process.exit(1);
  }

  console.log("Blocking architecture checks passed.");
  if (warningCount > 0) {
    console.log("Warnings remain and should be paid down during the restructure.");
  }
}

main();
