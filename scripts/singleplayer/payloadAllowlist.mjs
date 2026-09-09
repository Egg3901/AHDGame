/**
 * Runtime allowlist for the singleplayer payload.
 *
 * Next's standalone file trace copies source, tests, and markdown the local
 * game never reads. Keep only what launch.mjs + server.js need at runtime:
 * the standalone server, traced node_modules (including generated mongodb
 * aliases), .next, public, launch.mjs, and the JSON/changelog files the
 * compiled server still opens from disk.
 */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const PAYLOAD_BUDGETS = {
  strayTs: 0,
  tests: 0,
  docs: 0,
  plans: 0,
};

const TOP_FILES = new Set([
  "server.js",
  "package.json",
  "launch.mjs",
  "README.txt",
  "LICENSE.md",
  "AHD_BUILD.json",
]);

const TOP_DIRS = new Set([".next", "public", "node_modules"]);

/** Nested runtime files Next still reads with fs from process.cwd(). */
const NESTED_KEEP = [
  { prefix: "src/data/", suffix: ".json" },
  { prefix: "content/changelog/public/", suffix: ".md" },
  { prefix: "content/changelog/legacy/", suffix: ".md" },
];

const REQUIRED_PATHS = [
  "server.js",
  "launch.mjs",
  "package.json",
  ".next/static",
  ".next/server",
  "public",
  "node_modules",
];

const CACHE_DIRS = [path.join(".next", "cache")];

const ALIAS_PATTERN = /require\("([a-z0-9][a-z0-9-]+-[a-f0-9]{16})"\)/g;

export function toPosix(rel) {
  return rel.split(path.sep).join("/");
}

export function shouldKeepPayloadPath(relPosix) {
  if (!relPosix || relPosix === ".") return true;
  if (TOP_FILES.has(relPosix)) return true;
  const top = relPosix.split("/")[0];
  if (TOP_DIRS.has(top)) return true;
  for (const rule of NESTED_KEEP) {
    if (relPosix.startsWith(rule.prefix) && relPosix.endsWith(rule.suffix)) return true;
  }
  return false;
}

export function walkPayloadFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) visit(full);
      else files.push(toPosix(path.relative(root, full)));
    }
  };
  visit(root);
  return files;
}

function isTestPath(rel) {
  return /(^|\/)(tests|e2e)(\/|$)/.test(rel) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rel);
}

function isStrayTs(rel) {
  return rel.startsWith("src/") && /\.[cm]?tsx?$/.test(rel);
}

function isDocsPath(rel) {
  return rel === "docs" || rel.startsWith("docs/");
}

function isPlanMarkdown(rel) {
  if (!rel.endsWith(".md")) return false;
  if (rel.startsWith("node_modules/")) return false;
  if (rel === "LICENSE.md") return false;
  if (rel.startsWith("content/changelog/public/")) return false;
  if (rel.startsWith("content/changelog/legacy/")) return false;
  return (
    /(?:^|\/)(?:AGENTS|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|CHANGELOG|PUBLIC_CHANGELOG|README)\.md$/.test(
      rel
    ) ||
    /plan/i.test(rel) ||
    rel.startsWith("content/changelog/unreleased/") ||
    rel.startsWith("content/changelog/dev/") ||
    rel.startsWith("scripts/sim/") ||
    /\/audit\//.test(rel) ||
    /CONTEXT\.md$/.test(rel)
  );
}

export function classifyPayloadPath(relPosix) {
  if (shouldKeepPayloadPath(relPosix)) return "keep";
  return "drop";
}

export function findRequiredMongodbAliases(root) {
  const chunkDir = path.join(root, ".next", "server", "chunks");
  const aliases = new Set();
  if (!existsSync(chunkDir)) return aliases;
  for (const entry of readdirSync(chunkDir)) {
    if (!entry.endsWith(".js")) continue;
    const source = readFileSync(path.join(chunkDir, entry), "utf8");
    for (const match of source.matchAll(ALIAS_PATTERN)) aliases.add(match[1]);
  }
  return aliases;
}

export function materializeMongodbAliases(root) {
  const aliases = findRequiredMongodbAliases(root);
  const created = [];
  for (const alias of aliases) {
    const base = alias.replace(/-[a-f0-9]{16}$/, "");
    const from = path.join(root, "node_modules", base);
    const to = path.join(root, "node_modules", alias);
    if (existsSync(from) && !existsSync(to)) {
      cpSync(from, to, { recursive: true });
      created.push(alias);
    }
  }
  return { aliases: [...aliases], created };
}

function pruneEmptyDirs(root) {
  const visit = (dir) => {
    if (!existsSync(dir)) return true;
    let empty = true;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!visit(full)) empty = false;
      } else {
        empty = false;
      }
    }
    if (empty && dir !== root) {
      rmSync(dir, { recursive: true, force: true });
      return true;
    }
    return false;
  };
  visit(root);
}

export function applyPayloadAllowlist(root) {
  const dropped = [];
  for (const rel of walkPayloadFiles(root)) {
    if (shouldKeepPayloadPath(rel)) continue;
    rmSync(path.join(root, ...rel.split("/")), { force: true });
    dropped.push(rel);
  }
  for (const extra of CACHE_DIRS) {
    rmSync(path.join(root, extra), { recursive: true, force: true });
  }
  pruneEmptyDirs(root);
  return dropped;
}

export function inspectPayload(root, { nativePlatform } = {}) {
  const files = walkPayloadFiles(root);
  const missing = [];
  const kept = [];
  const dropped = [];
  for (const req of REQUIRED_PATHS) {
    if (!existsSync(path.join(root, ...req.split("/")))) missing.push(req);
  }
  const aliases = findRequiredMongodbAliases(root);
  for (const alias of aliases) {
    if (!existsSync(path.join(root, "node_modules", alias))) {
      missing.push(`node_modules/${alias}`);
    }
  }
  if (existsSync(path.join(root, "node_modules", "mongodb")) === false) {
    missing.push("node_modules/mongodb");
  }
  if (existsSync(path.join(root, "node_modules", "sharp"))) {
    const imgDir = path.join(root, "node_modules", "@img");
    const natives = existsSync(imgDir)
      ? readdirSync(imgDir).filter((name) => name.startsWith("sharp-") && name !== "sharp-wasm32")
      : [];
    if (nativePlatform) {
      const want = natives.filter(
        (name) => name === `sharp-${nativePlatform}` || name === `sharp-libvips-${nativePlatform}`
      );
      if (want.length === 0) missing.push(`node_modules/@img/sharp-${nativePlatform}`);
    } else if (natives.length === 0) {
      missing.push("node_modules/@img/sharp-<platform>");
    }
  }

  let strayTs = 0;
  let tests = 0;
  let docs = 0;
  let plans = 0;
  for (const rel of files) {
    if (rel.startsWith("node_modules/")) continue;
    if (classifyPayloadPath(rel) === "keep") kept.push(rel);
    else dropped.push(rel);
    if (isStrayTs(rel)) strayTs += 1;
    if (isTestPath(rel)) tests += 1;
    if (isDocsPath(rel)) docs += 1;
    if (isPlanMarkdown(rel)) plans += 1;
  }

  const counts = { strayTs, tests, docs, plans, files: files.length };
  const budgetHits = [];
  for (const [key, max] of Object.entries(PAYLOAD_BUDGETS)) {
    if (counts[key] > max) budgetHits.push(`${key} ${counts[key]} > ${max}`);
  }
  return {
    ok: missing.length === 0 && budgetHits.length === 0,
    missing,
    budgetHits,
    counts,
    aliases: [...aliases],
    kept,
    dropped,
  };
}

export function assertPayloadAllowed(root, options) {
  const report = inspectPayload(root, options);
  if (report.ok) return report;
  const parts = [];
  if (report.missing.length) parts.push(`missing ${report.missing.join(", ")}`);
  if (report.budgetHits.length) parts.push(report.budgetHits.join("; "));
  throw new Error(`singleplayer payload allowlist failed: ${parts.join("; ")}`);
}
