/**
 * Cut a release: fold every unreleased note into one post and take the version.
 *
 * Usage:
 *   npm run changelog:release -- 1.6.1 --title "Bond market depth"
 *   npm run changelog:release -- 1.7.0 --title "Labour" --lede "One paragraph."
 *   npm run changelog:release -- 1.6.1 --title "..." --no-public
 *
 * What it does, in order:
 *   1. reads content/changelog/unreleased/*.md
 *   2. writes content/changelog/dev/<version>.md, notes grouped by section
 *   3. writes content/changelog/public/<version>.md as a draft to edit
 *   4. sets the version in package.json
 *   5. deletes the notes it folded
 *
 * This is the only thing that mints a version. A pull request writes a note and
 * nothing else, which is what stops the numbering running away: it reached
 * 1.4.63 in six weeks when every pull request took a patch number of its own.
 *
 * Merging the result to main is what publishes it: the release workflow tags
 * v<version> and opens the GitHub release from the public post.
 */
import fs from "fs";
import path from "path";
import { parseFrontmatter, asString, asStringArray } from "../../src/lib/changelog/frontmatter";
import { DEV_POSTS_DIR, PUBLIC_POSTS_DIR, UNRELEASED_DIR } from "../../src/lib/changelog/paths";
import { usedDevVersions } from "../../src/lib/changelog/entryFiles";
import {
  foldNotes,
  releaseAreas,
  releaseBadge,
  releaseTags,
  type ReleaseNote,
} from "../../src/lib/changelog/releaseNotes";
import { BADGE_VALUES } from "../../src/lib/changelog/types";
import type { ChangelogBadge } from "../../src/lib/changelog/types";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function readNotes(): ReleaseNote[] {
  if (!fs.existsSync(UNRELEASED_DIR)) return [];
  return fs
    .readdirSync(UNRELEASED_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const raw = fs.readFileSync(path.join(UNRELEASED_DIR, name), "utf-8");
      const { data } = parseFrontmatter(raw);
      const title = asString(data.title);
      if (!title) fail(`content/changelog/unreleased/${name} has no title.`);
      return {
        topic: name.slice(0, -3),
        title,
        summary: asString(data.summary).replace(/\s+/g, " ").trim(),
        date: asString(data.date),
        tags: asStringArray(data.tags),
        badges: asStringArray(data.badges) as ChangelogBadge[],
        areas: asStringArray(data.areas),
      };
    });
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

function frontmatter(fields: Record<string, string | string[] | undefined>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else if (key === "summary") {
      lines.push("summary: >-");
      lines.push(...wrap(value, 76).map((l) => `  ${l}`));
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---", "", "");
  return lines.join("\n");
}

function main(): void {
  const flagValues = new Set(
    ["title", "summary", "lede", "date", "badge"]
      .map(flag)
      .filter((v): v is string => v !== undefined)
  );
  const version = process.argv.slice(2).find((a) => !a.startsWith("--") && !flagValues.has(a));

  if (!version) {
    fail(
      'Usage: npm run changelog:release -- <version> --title "Release title"' +
        ' [--summary "..."] [--lede "..."] [--badge minor] [--no-public]'
    );
  }
  if (!SEMVER_RE.test(version)) fail(`"${version}" is not a MAJOR.MINOR.PATCH version.`);

  const pkgPath = path.join(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
  if (compareVersions(version, pkg.version) <= 0) {
    fail(
      `${version} is not ahead of the current version ${pkg.version}. ` +
        "A release only ever moves forward."
    );
  }
  if (usedDevVersions().includes(version)) {
    fail(`content/changelog/dev/${version}.md already exists.`);
  }

  const notes = readNotes();
  if (notes.length === 0) {
    fail(
      "No notes in content/changelog/unreleased/, so there is nothing to release. " +
        'Write one with `npm run changelog:new -- "Title"`.'
    );
  }

  const title = flag("title");
  if (!title) fail(`--title is required: it is the headline for ${version} on the feed.`);

  const badgeFlag = flag("badge");
  if (badgeFlag && !BADGE_VALUES.includes(badgeFlag as ChangelogBadge)) {
    fail(`unknown badge "${badgeFlag}"; valid badges are ${BADGE_VALUES.join(", ")}.`);
  }
  const badge = (badgeFlag as ChangelogBadge | undefined) ?? releaseBadge(notes);
  const date = flag("date") ?? new Date().toISOString().slice(0, 10);
  const summary =
    flag("summary") ??
    `${notes.length} ${notes.length === 1 ? "change" : "changes"}. ` +
      notes
        .slice(0, 3)
        .map((n) => n.title)
        .join(". ") +
      ".";
  const lede = flag("lede") ?? "TODO: one or two paragraphs on what this release is about.";

  const devPath = path.join(DEV_POSTS_DIR, `${version}.md`);
  fs.mkdirSync(DEV_POSTS_DIR, { recursive: true });
  fs.writeFileSync(
    devPath,
    frontmatter({
      version,
      date,
      title: `${version}: ${title}`,
      summary,
      tags: releaseTags(notes),
      areas: releaseAreas(notes),
      badges: [badge],
    }) + `${foldNotes(notes, lede)}\n`,
    "utf-8"
  );

  let publicPath: string | null = null;
  if (!has("no-public")) {
    publicPath = path.join(PUBLIC_POSTS_DIR, `${version}.md`);
    fs.mkdirSync(PUBLIC_POSTS_DIR, { recursive: true });
    // A draft, not a generated post. The public feed is player-facing copy and
    // reads as prose, so the notes are listed here as raw material to rewrite,
    // not as the finished page.
    const drafted = notes
      .map((n) => `- **${n.title}**${n.summary ? `\n  ${n.summary}` : ""}`)
      .join("\n");
    fs.writeFileSync(
      publicPath,
      frontmatter({
        version,
        date,
        // A .0 release is known by its line ("1.6: Play offline"); a patch
        // release inside it is not, so it keeps the full number.
        title: `${version.endsWith(".0") ? version.slice(0, -2) : version}: ${title}`,
        summary: "TODO: two or three sentences, written for a player.",
        tags: releaseTags(notes, 8),
        badges: [badge],
      }) +
        `TODO: rewrite this as prose for players. What follows is the raw material.\n\n${drafted}\n`,
      "utf-8"
    );
  }

  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");

  for (const note of notes) {
    fs.unlinkSync(path.join(UNRELEASED_DIR, `${note.topic}.md`));
  }

  console.log(`${path.relative(process.cwd(), devPath)}  (${notes.length} notes folded)`);
  if (publicPath) console.log(`${path.relative(process.cwd(), publicPath)}  (draft, rewrite it)`);
  console.log(`package.json version -> ${version}`);
  console.log("");
  console.log(`Next: edit the lede, rewrite the public post, then open the release pull request.`);
  console.log(`Merging it to main tags v${version} and opens the GitHub release.`);
}

main();
