/**
 * Create a dev changelog entry that cannot collide with a parallel branch.
 *
 * Usage:
 *   npm run changelog:new -- "Union dues cost campaign funds"
 *   npm run changelog:new -- "Title" --topic union-dues --version 1.2.21
 *
 * The topic defaults to the current git branch name, which is unique per branch
 * by construction, so two people running this at the same moment still get two
 * different files. The version defaults to the next unused patch, but it is only
 * a suggestion: if another branch lands the same number first, both entries
 * still merge cleanly and the release owner renumbers at their leisure.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { DEV_POSTS_DIR } from "../../src/lib/changelog/paths";
import {
  devEntryFileName,
  toEntrySuffix,
  usedDevVersions,
} from "../../src/lib/changelog/entryFiles";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function currentBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "entry";
  }
}

function nextPatch(): string {
  const versions = usedDevVersions().map((v) => v.split(".").map(Number));
  const [maj, min] = versions.reduce(
    (best, v) => (v[0] > best[0] || (v[0] === best[0] && v[1] > best[1]) ? v : best),
    [0, 0, 0]
  );
  const patch = versions
    .filter((v) => v[0] === maj && v[1] === min)
    .reduce((max, v) => Math.max(max, v[2]), -1);
  return `${maj}.${min}.${patch + 1}`;
}

function main(): void {
  const title = process.argv
    .slice(2)
    .find((a) => !a.startsWith("--") && a !== flag("topic") && a !== flag("version"));
  if (!title) {
    console.error(
      'Usage: npm run changelog:new -- "Title of the change" [--topic slug] [--version 1.2.21]'
    );
    process.exit(1);
  }

  const version = flag("version") ?? nextPatch();
  const topic = toEntrySuffix(flag("topic") ?? currentBranch().replace(/^[a-z]+\//, ""));
  if (!topic) {
    console.error("Could not derive a topic; pass --topic <slug>.");
    process.exit(1);
  }

  const fileName = devEntryFileName(version, topic);
  const filePath = path.join(DEV_POSTS_DIR, fileName);
  if (fs.existsSync(filePath)) {
    console.error(`${fileName} already exists.`);
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);
  const body = `---
version: "${version}"
date: ${date}
title: ${title}
summary: >-
  One or two sentences on what changed and why it matters.
tags: []
badges: [patch]
areas: []
---

## What changed

- 
`;
  fs.mkdirSync(DEV_POSTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, body, "utf-8");
  console.log(path.relative(process.cwd(), filePath));
}

main();
