/**
 * Write the changelog note for a change, in the same pull request as the change.
 *
 * Usage:
 *   npm run changelog:new -- "Union dues cost campaign funds"
 *   npm run changelog:new -- "Title" --topic union-dues
 *   npm run changelog:new -- "Title" --badges minor --areas backend,engine
 *
 * The note carries no version. It lands in content/changelog/unreleased/ named
 * for its topic, which defaults to the current branch and is therefore unique
 * per branch by construction, so two branches never write the same path.
 * `npm run changelog:release` folds every note into one release post and
 * assigns the version then.
 *
 * This used to hand out the next unused patch number, which made a version a
 * per-pull-request unit and took the numbering to 1.4.63 in six weeks.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { UNRELEASED_DIR } from "../../src/lib/changelog/paths";
import {
  toEntrySuffix,
  unknownValueMessage,
  unreleasedFileName,
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

function main(): void {
  const flagValues = new Set(
    ["topic", "badges", "areas"].map(flag).filter((v): v is string => v !== undefined)
  );
  const title = process.argv.slice(2).find((a) => !a.startsWith("--") && !flagValues.has(a));
  if (!title) {
    console.error(
      'Usage: npm run changelog:new -- "Title of the change" [--topic slug]' +
        " [--badges patch] [--areas backend,engine]"
    );
    console.error(`  badges: ${BADGE_VALUES.join(", ")}`);
    console.error(`  areas:  ${AREA_VALUES.join(", ")}`);
    process.exit(1);
  }

  const badges = vocabularyFlag("badges", BADGE_VALUES) ?? ["patch"];
  const areas = vocabularyFlag("areas", AREA_VALUES) ?? [];
  const topic = toEntrySuffix(flag("topic") ?? currentBranch().replace(/^[a-z]+\//, ""));
  if (!topic) {
    console.error("Could not derive a topic; pass --topic <slug>.");
    process.exit(1);
  }

  const fileName = unreleasedFileName(topic);
  const filePath = path.join(UNRELEASED_DIR, fileName);
  if (fs.existsSync(filePath)) {
    console.error(`${fileName} already exists; edit it or pass a different --topic.`);
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);
  // The vocabulary is listed in the file itself. It used to live only in
  // posts.ts, where the loader dropped unknown values without a word, so
  // authors guessed: "minor", "bugfix", "balance" and "engine" all reached CI
  // and each one cost a full build cycle on development.
  const body = `---
date: ${date}
title: ${title}
summary: >-
  One or two sentences on what changed and why it matters. This is the text
  that appears under the change in the release post, so write it for a reader
  who was not in the pull request.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: []
# How big this change is, which sets how it is grouped in the release post.
# One of: ${BADGE_VALUES.join(" | ")}
badges: [${badges.join(", ")}]
# Which part of the codebase moved. Any of: ${AREA_VALUES.join(" | ")}
areas: [${areas.join(", ")}]
---

## What changed

- 
`;
  fs.mkdirSync(UNRELEASED_DIR, { recursive: true });
  fs.writeFileSync(filePath, body, "utf-8");
  console.log(path.relative(process.cwd(), filePath));
}

main();
