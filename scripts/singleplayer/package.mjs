#!/usr/bin/env node
/**
 * Builds the singleplayer distribution: a Next standalone build with the art
 * CDN pointed at the local /cdn mirror, plus the launcher and the static
 * assets Next leaves out of the standalone tree.
 *
 *   node scripts/singleplayer/package.mjs
 *
 * Output: dist/singleplayer/  (run with `node launch.mjs` from inside it)
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "dist", "singleplayer");
const STANDALONE = path.join(ROOT, ".next", "standalone");

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const build = spawnSync(npx, ["next", "build"], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    SINGLEPLAYER: "1",
    NEXT_PUBLIC_CDN_BASE: "/cdn",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
if (build.error) {
  console.error(`failed to start Next.js build: ${build.error.message}`);
}
if (build.status !== 0) process.exit(build.status ?? 1);
if (!existsSync(path.join(STANDALONE, "server.js"))) {
  console.error("standalone output missing; next.config.ts only emits it when SINGLEPLAYER=1");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(STANDALONE, OUT, { recursive: true });
cpSync(path.join(ROOT, ".next", "static"), path.join(OUT, ".next", "static"), { recursive: true });
cpSync(path.join(ROOT, "public"), path.join(OUT, "public"), { recursive: true });
cpSync(path.join(ROOT, "scripts", "singleplayer", "launch.mjs"), path.join(OUT, "launch.mjs"));

// Turbopack's standalone trace copies `mongodb`, but generated server chunks
// require a content-addressed alias such as `mongodb-438b504308ffa4be`.
// Node resolves that as a separate package and Windows dies before readiness
// unless the alias is present. Materialize every traced package alias rather
// than pinning one hash or one dependency.
const chunkDir = path.join(OUT, ".next", "server", "chunks");
const aliasPattern = /require\("([a-z0-9][a-z0-9-]+-[a-f0-9]{16})"\)/g;
const aliases = new Set();
for (const entry of readdirSync(chunkDir)) {
  if (!entry.endsWith(".js")) continue;
  const source = readFileSync(path.join(chunkDir, entry), "utf8");
  for (const match of source.matchAll(aliasPattern)) aliases.add(match[1]);
}
for (const alias of aliases) {
  const base = alias.replace(/-[a-f0-9]{16}$/, "");
  const from = path.join(OUT, "node_modules", base);
  const to = path.join(OUT, "node_modules", alias);
  if (existsSync(from) && !existsSync(to)) cpSync(from, to, { recursive: true });
}

// The file trace is generous; none of these are read at runtime.
for (const dir of [
  "tests",
  "e2e",
  "docs",
  "tools",
  "eslint-rules",
  ".github",
  path.join(".next", "cache"),
]) {
  rmSync(path.join(OUT, dir), { recursive: true, force: true });
}
writeFileSync(
  path.join(OUT, "README.txt"),
  [
    "A House Divided, singleplayer",
    "",
    "Requires Node.js 20 or newer. Then:",
    "",
    "    node launch.mjs",
    "",
    "The first start downloads MongoDB (about 30 to 100 MB depending on your",
    "system) into ~/.a-house-divided and keeps it there. Everything about your",
    "world lives in that folder; delete it to start completely fresh.",
    "",
  ].join("\n")
);
console.log(`singleplayer build ready in ${OUT}`);
