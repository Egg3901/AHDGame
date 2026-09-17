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
export const BUILD_PROVENANCE_FILE = "build-provenance.json";
export const BUILD_PROVENANCE_SCHEMA_VERSION = 1;

/**
 * @typedef {{schemaVersion: number, sourceCommit: string | null, sourceDirty: boolean | null,
 *   status: "clean" | "dirty" | "unknown"}} BuildProvenance
 */

function runGit(args, root) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * @param {string} [root]
 * @param {(args: string[], root: string) => {status: number | null, stdout: string | null}} [git]
 * @returns {BuildProvenance}
 */
export function captureBuildProvenance(root = ROOT, git = runGit) {
  const revision = git(["rev-parse", "HEAD"], root);
  const sourceCommit = revision.status === 0 ? (revision.stdout ?? "").trim() : null;
  if (!sourceCommit || !/^[0-9a-f]{40,64}$/i.test(sourceCommit)) {
    return {
      schemaVersion: BUILD_PROVENANCE_SCHEMA_VERSION,
      sourceCommit: null,
      sourceDirty: null,
      status: "unknown",
    };
  }

  const status = git(["status", "--porcelain=v1", "--untracked-files=all"], root);
  if (status.status !== 0) {
    return {
      schemaVersion: BUILD_PROVENANCE_SCHEMA_VERSION,
      sourceCommit,
      sourceDirty: null,
      status: "unknown",
    };
  }

  const sourceDirty = (status.stdout ?? "").trim().length > 0;
  return {
    schemaVersion: BUILD_PROVENANCE_SCHEMA_VERSION,
    sourceCommit,
    sourceDirty,
    status: sourceDirty ? "dirty" : "clean",
  };
}

/** @param {BuildProvenance} before @param {BuildProvenance} after @returns {BuildProvenance} */
export function finalizeBuildProvenance(before, after) {
  if (
    before.sourceCommit !== after.sourceCommit ||
    before.sourceDirty !== after.sourceDirty ||
    before.status !== after.status
  ) {
    return unknownBuildProvenance();
  }
  return before;
}

/** @returns {BuildProvenance} */
function unknownBuildProvenance() {
  return {
    schemaVersion: BUILD_PROVENANCE_SCHEMA_VERSION,
    sourceCommit: null,
    sourceDirty: null,
    status: "unknown",
  };
}

export function writeBuildProvenance(out, provenance) {
  writeFileSync(
    path.join(out, BUILD_PROVENANCE_FILE),
    `${JSON.stringify({ ...unknownBuildProvenance(), ...provenance }, null, 2)}\n`
  );
}

export function assembleSingleplayerPayload({
  root = ROOT,
  out = path.join(root, "dist", "singleplayer"),
  standalone = path.join(root, ".next", "standalone"),
  buildProvenance = unknownBuildProvenance(),
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
  writeBuildProvenance(out, buildProvenance);
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
  const beforeBuild = captureBuildProvenance(root);
  buildStandalone(root);
  const buildProvenance = finalizeBuildProvenance(beforeBuild, captureBuildProvenance(root));
  const out = assembleSingleplayerPayload({ root, buildProvenance });
  console.log(`singleplayer build ready in ${out}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageSingleplayer();
}
