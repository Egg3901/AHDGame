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
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPayloadAllowlist,
  assertPayloadAllowed,
  materializeMongodbAliases,
} from "./payloadAllowlist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function assembleSingleplayerPayload({
  root = ROOT,
  out = path.join(root, "dist", "singleplayer"),
  standalone = path.join(root, ".next", "standalone"),
} = {}) {
  if (!existsSync(path.join(standalone, "server.js"))) {
    throw new Error("standalone output missing; next.config.ts only emits it when SINGLEPLAYER=1");
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(standalone, out, { recursive: true });
  cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), {
    recursive: true,
  });
  cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
  cpSync(path.join(root, "scripts", "singleplayer", "launch.mjs"), path.join(out, "launch.mjs"));

  materializeMongodbAliases(out);
  applyPayloadAllowlist(out);
  writeFileSync(
    path.join(out, "README.txt"),
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
  assertPayloadAllowed(out);
  return out;
}

function buildStandalone(root) {
  const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const build = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: root,
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
}

export function packageSingleplayer(root = ROOT) {
  buildStandalone(root);
  const out = assembleSingleplayerPayload({ root });
  console.log(`singleplayer build ready in ${out}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageSingleplayer();
}
