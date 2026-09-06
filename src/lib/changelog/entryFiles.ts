import fs from "fs";
import path from "path";
import { parseFrontmatter, asString, asStringArray } from "./frontmatter";
import { DEV_POSTS_DIR, PUBLIC_POSTS_DIR, UNRELEASED_DIR } from "./paths";
import { AREA_VALUES, BADGE_VALUES } from "./types";

/**
 * Changelog entry filenames.
 *
 * An entry file used to be named for a version, and the generator handed out
 * the next unused patch number. That made a version a per-pull-request unit:
 * 313 entries reached 1.4.63 in six weeks, 193 of them inside one minor line,
 * with dozens of files sharing a patch number and a topic suffix to tell them
 * apart. Nobody could say what "1.4.38" was, because it was not anything: it
 * was six unrelated pull requests that happened to merge on the same afternoon.
 *
 * A version is now a release, and only the release script mints one:
 *
 *   content/changelog/unreleased/<topic>.md   one per pull request, no version
 *   content/changelog/dev/<version>.md        one per release, written by the release script
 *   content/changelog/public/<version>.md     one per release, curated
 *
 * The unreleased note carries no version field at all, so there is nothing to
 * guess, nothing to renumber, and no add/add conflict between branches: two
 * branches write two different topics. `npm run changelog:release` folds every
 * note into one dev post, bumps package.json, and empties the directory.
 */

/** `1.2.3`, and nothing else: a release entry's stem is its version. */
const VERSION_STEM_RE = /^(\d+\.\d+\.\d+)$/;

/** `union-dues`, `ticket-1122`: lowercase words joined by single hyphens. */
const TOPIC_STEM_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseVersionStem(stem: string): string | null {
  const match = stem.match(VERSION_STEM_RE);
  return match ? match[1] : null;
}

/** Lowercase, hyphen-joined form of a free-text topic, for use as a filename. */
export function toEntrySuffix(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function unreleasedFileName(topic: string): string {
  return `${toEntrySuffix(topic)}.md`;
}

export function releaseEntryFileName(version: string): string {
  return `${version}.md`;
}

/**
 * Damage a conflict-resolution script left on 1.2.4 and 1.2.8: a blank line
 * after the opening delimiter, an unindented `>-` block, or a frontmatter block
 * that is never closed. The parser returns an empty object for all three, so the
 * entry loads as nothing and silently disappears from the feed instead of
 * failing loudly. Named here so the guard reports the cause, not just the
 * missing fields that follow from it.
 */
export function frontmatterDamage(raw: string): string[] {
  const found: string[] = [];
  const lines = raw.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    found.push("file does not open with a --- frontmatter delimiter");
    return found;
  }
  if (lines[1]?.trim() === "") {
    found.push("blank line directly after the opening --- delimiter");
  }

  const closeIdx = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closeIdx === -1) {
    found.push("frontmatter is never closed by a second --- delimiter");
    return found;
  }

  for (let i = 1; i < closeIdx; i++) {
    if (!/^[A-Za-z0-9_-]+:\s*>-?\s*$/.test(lines[i])) continue;
    const next = lines[i + 1];
    if (next !== undefined && next.trim() !== "" && !/^\s/.test(next)) {
      found.push(`block scalar on line ${i + 1} has unindented content beneath it`);
    }
  }

  return found;
}

export interface EntryProblem {
  file: string;
  problem: string;
}

/** A release post is a published thing and needs a version; a note does not. */
const RELEASE_REQUIRED_FIELDS = ["version", "date", "title"] as const;
const UNRELEASED_REQUIRED_FIELDS = ["date", "title"] as const;
const BADGES = new Set<string>(BADGE_VALUES);
const AREAS = new Set<string>(AREA_VALUES);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Say what is allowed, not just what was rejected.
 *
 * `unknown badge "minor"` told the author nothing they could act on without
 * opening posts.ts, and it arrived from CI on someone else's branch. The valid
 * set is short enough to print in full, and the pointer to `tags` matters
 * because most rejected values ("bugfix", "balance", "economy") were authors
 * describing the change, which is what the free-text `tags` field is for.
 */
export function unknownValueMessage(field: "badge" | "area", value: string): string {
  const allowed = field === "badge" ? BADGE_VALUES : AREA_VALUES;
  return (
    `unknown ${field} "${value}"; valid ${field}s are ${allowed.join(", ")}. ` +
    `Descriptive words for what the change was about belong in "tags", which is free text.`
  );
}

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

export type EntryKind = "release" | "unreleased";

/**
 * Check every entry in a directory.
 *
 * `release` is the published rule: the stem is the version and, for public
 * entries, the URL. `unreleased` is the opposite rule and the one that keeps
 * the numbering sane: a note is named for its topic and must not carry a
 * version at all, because only a release has one.
 */
export function checkEntryDir(dir: string, opts: { kind: EntryKind }): EntryProblem[] {
  const problems: EntryProblem[] = [];
  const unreleased = opts.kind === "unreleased";

  for (const name of listMarkdown(dir)) {
    const stem = name.slice(0, -3);
    const raw = fs.readFileSync(path.join(dir, name), "utf-8");
    const { data } = parseFrontmatter(raw);
    const version = asString(data.version);

    if (unreleased) {
      // Version first: `1.6.1` fails the topic pattern too, and "name it for
      // the topic" does not tell the author the actual rule they broke.
      if (parseVersionStem(stem)) {
        problems.push({
          file: name,
          problem:
            "an unreleased note must not be named for a version; the release script " +
            "assigns one when the release is cut",
        });
      } else if (!TOPIC_STEM_RE.test(stem)) {
        problems.push({
          file: name,
          problem:
            "an unreleased note is named for its topic, lowercase and hyphenated, " +
            'e.g. union-dues.md. Run `npm run changelog:new -- "Title"`.',
        });
      }
      if (version) {
        problems.push({
          file: name,
          problem:
            `remove "version: ${version}". Only a release has a version, and ` +
            "`npm run changelog:release` writes it. A note that picks its own number is " +
            "how the numbering ran to 1.4.63 in six weeks.",
        });
      }
    } else {
      const parsedVersion = parseVersionStem(stem);
      if (!parsedVersion) {
        problems.push({
          file: name,
          problem:
            "a release entry is named for its version alone, e.g. 1.6.0.md. " +
            "Per-change notes go in content/changelog/unreleased/.",
        });
      } else if (version && version !== parsedVersion) {
        problems.push({
          file: name,
          problem: `frontmatter version "${version}" does not match filename version "${parsedVersion}"`,
        });
      }
    }

    for (const damage of frontmatterDamage(raw)) {
      problems.push({ file: name, problem: damage });
    }

    for (const field of unreleased ? UNRELEASED_REQUIRED_FIELDS : RELEASE_REQUIRED_FIELDS) {
      if (!asString(data[field])) {
        problems.push({ file: name, problem: `missing frontmatter field "${field}"` });
      }
    }

    const entryDate = asString(data.date);
    if (entryDate && !DATE_RE.test(entryDate)) {
      problems.push({ file: name, problem: `date "${entryDate}" is not YYYY-MM-DD` });
    }

    for (const badge of asStringArray(data.badges)) {
      if (badge && !BADGES.has(badge)) {
        problems.push({ file: name, problem: unknownValueMessage("badge", badge) });
      }
    }
    for (const area of asStringArray(data.areas)) {
      if (area && !AREAS.has(area)) {
        problems.push({ file: name, problem: unknownValueMessage("area", area) });
      }
    }
  }

  return problems;
}

/**
 * Slots that two entries must never share.
 *
 * The filename stem is the feed's React key and the public route's slug, so a
 * duplicate stem is a real bug. Git already makes a duplicate stem impossible
 * inside one directory, but the same stem across dev and public is fine and
 * expected, so each directory is checked on its own.
 */
export function duplicateStems(dir: string): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const name of listMarkdown(dir)) {
    const stem = name.slice(0, -3).toLowerCase();
    if (seen.has(stem)) dupes.push(stem);
    seen.add(stem);
  }
  return dupes;
}

/** Every version a dev release post already claims, oldest first. */
export function usedDevVersions(): string[] {
  return listMarkdown(DEV_POSTS_DIR)
    .map((name) => parseVersionStem(name.slice(0, -3)))
    .filter((v): v is string => Boolean(v));
}

/** Notes waiting for a release, oldest filename first. */
export function unreleasedNoteFiles(): string[] {
  return listMarkdown(UNRELEASED_DIR);
}

export const ENTRY_DIRS: { dir: string; label: string; kind: EntryKind }[] = [
  { dir: DEV_POSTS_DIR, label: "dev", kind: "release" },
  { dir: PUBLIC_POSTS_DIR, label: "public", kind: "release" },
  { dir: UNRELEASED_DIR, label: "unreleased", kind: "unreleased" },
];
