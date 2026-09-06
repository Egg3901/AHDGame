#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const version = process.argv[2];
const platform = process.argv[3];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "") || !/^[a-z0-9_-]+$/.test(platform ?? "")) {
  throw new Error("usage: release-package.mjs <version> <platform>");
}
const root = process.cwd();
const packageVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
if (packageVersion !== version) {
  throw new Error(`release tag ${version} does not match package version ${packageVersion}`);
}
const source = path.join(root, "dist", "singleplayer");
const output = path.join(root, "release-assets");
const temp = mkdtempSync(path.join(tmpdir(), "ahd-singleplayer-release-"));
const staged = path.join(temp, "game");
mkdirSync(output, { recursive: true });
cpSync(source, staged, { recursive: true });
const name = `ahd-singleplayer-v${version}-${platform}.tar.gz`;
const archive = path.join(output, name);
const result = spawnSync("tar", ["-czf", archive, "-C", temp, "game"], { stdio: "inherit" });
if (result.status !== 0) throw new Error("tar failed");
const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${digest}  ${name}\n`);
rmSync(temp, { recursive: true, force: true });
console.log(archive);
