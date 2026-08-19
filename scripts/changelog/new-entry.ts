/**
 * Create a dev changelog entry that cannot collide with a parallel branch.
 *
 * Usage:
 *   npm run changelog:new -- "Union dues cost campaign funds"
 *   npm run changelog:new -- "Title" --topic union-dues --version 1.2.21
 *   npm run changelog:new -- "Title" --badges minor --areas backend,engine
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
  unknownValueMessage,
  usedDevVersions,
} from "../../src/lib/changelog/entryFiles";
import { AREA_VALUES, BADGE_VALUES } from "../../src/lib/changelog/types";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Read a comma-separated `--badges` / `--areas` flag, rejecting anything the
 * loader would silently drop.
 *
 * The generator is the only authoring path anyone is told about, so it is the
 * cheapest place to stop a bad value: the author finds out in the second it
 * takes to write the file, instead of from a red build on development twenty
 * minutes later that also blocks every other open pull request.
 */
function vocabularyFlag(
  name: "badges" | "areas",
  allowed: readonly string[]
): string[] | undefined {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const values = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const field = name === "badges" ? "badge" : "area";
  const bad = values.filter((v) => !allowed.includes(v));
  if (bad.length > 0) {
    for (const value of bad) console.error(unknownValueMessage(field, value));
    process.exit(1);
  }
  return values.length > 0 ? values : undefined;
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
  const flagValues = new Set(
    ["topic", "version", "badges", "areas"].map(flag).filter((v): v is string => v !== undefined)
  );
  const title = process.argv.slice(2).find((a) => !a.startsWith("--") && !flagValues.has(a));
  if (!title) {
    console.error(
      'Usage: npm run changelog:new -- "Title of the change" [--topic slug] [--version 1.2.21]' +
        " [--badges patch] [--areas backend,engine]"
    );
    console.error(`  badges: ${BADGE_VALUES.join(", ")}`);
    console.error(`  areas:  ${AREA_VALUES.join(", ")}`);
    process.exit(1);
  }

  const badges = vocabularyFlag("badges", BADGE_VALUES) ?? ["patch"];
  const areas = vocabularyFlag("areas", AREA_VALUES) ?? [];
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
  // The vocabulary is listed in the file itself. It used to live only in
  // posts.ts, where the loader dropped unknown values without a word, so
  // authors guessed: "minor", "bugfix", "balance" and "engine" all reached CI
  // and each one cost a full build cycle on development.
  const body = `---
version: "${version}"
date: ${date}
title: ${title}
summary: >-
  One or two sentences on what changed and why it matters.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: []
# How big the release is. One of: ${BADGE_VALUES.join(" | ")}
badges: [${badges.join(", ")}]
# Which part of the codebase moved. Any of: ${AREA_VALUES.join(" | ")}
areas: [${areas.join(", ")}]
---

## What changed

- 
`;
  fs.mkdirSync(DEV_POSTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, body, "utf-8");
  console.log(path.relative(process.cwd(), filePath));
}

main();
