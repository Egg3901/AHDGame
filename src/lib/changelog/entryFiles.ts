import fs from "fs";
import path from "path";
import { parseFrontmatter, asString, asStringArray } from "./frontmatter";
import { DEV_POSTS_DIR, PUBLIC_POSTS_DIR } from "./paths";

/**
 * Changelog entry filenames.
 *
 * Entries used to be named for the version alone (`1.2.3.md`). The version was
 * therefore a scarce, first-come claim: every branch cut in parallel picked the
 * same "next free" number, and every one of those branches wrote the same path.
 * Git sees that as an add/add conflict, so each collision cost a conflict
 * resolution plus a fresh CI run, and an abandoned claim left a hole in the
 * numbering.
 *
 * The fix is to make the filename carry a per-entry discriminator:
 *
 *   content/changelog/dev/<version>-<suffix>.md
 *
 * where <suffix> is the ticket, issue or branch topic the entry belongs to.
 * Two branches now write two different paths, so the merge is a clean add/add
 * of separate files no matter what version each one guessed.
 *
 * Nothing downstream reads the version out of the filename: ordering and
 * grouping come from the frontmatter `version` and `date`, and the feed keys on
 * the filename stem (the slug). Two entries may claim the same version without
 * breaking anything, which is what removes the race.
 *
 * `content/changelog/public/` keeps the bare `<version>.md` form on purpose:
 * that stem is the public URL (`/changelog/<slug>`) and it is in the sitemap,
 * so it must stay stable. Public entries are curated once per release by one
 * author, so they never race.
 */

/** `1.2.3` or `1.2.3-my-topic`. */
const ENTRY_STEM_RE = /^(\d+\.\d+\.\d+)(?:-([a-z0-9]+(?:-[a-z0-9]+)*))?$/;

export interface EntryStem {
  version: string;
  /** Discriminator after the version, or null for the bare `<version>` form. */
  suffix: string | null;
}

export function parseEntryStem(stem: string): EntryStem | null {
  const match = stem.match(ENTRY_STEM_RE);
  if (!match) return null;
  return { version: match[1], suffix: match[2] ?? null };
}

/** Lowercase, hyphen-joined form of a free-text topic, for use as a suffix. */
export function toEntrySuffix(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export function devEntryFileName(version: string, suffix: string): string {
  return `${version}-${toEntrySuffix(suffix)}.md`;
}

/**
 * Dev entries that predate the suffix convention.
 *
 * They keep their bare `<version>.md` names so nothing that links to them or
 * quotes them has to change. The list only ever shrinks: a new entry is not
 * allowed to be added to it.
 */
export const LEGACY_BARE_DEV_STEMS = new Set<string>([
  "0.4.0",
  "0.4.1",
  "0.4.2",
  "1.0.0",
  "1.1.0",
  "1.1.1",
  "1.1.2",
  "1.1.7",
  "1.1.8",
  "1.1.9",
  "1.1.10",
  "1.1.11",
  "1.1.12",
  "1.1.13",
  "1.1.14",
  "1.1.15",
  "1.1.16",
  "1.1.17",
  "1.1.39",
  "1.2.0",
  "1.2.1",
  "1.2.2",
  "1.2.3",
  "1.2.4",
  "1.2.5",
  "1.2.6",
  "1.2.7",
  "1.2.8",
  "1.2.9",
  "1.2.10",
  "1.2.11",
  "1.2.12",
  "1.2.15",
]);

export interface EntryProblem {
  file: string;
  problem: string;
}

const REQUIRED_FIELDS = ["version", "date", "title"] as const;
const BADGES = new Set(["major", "patch", "hotfix"]);
const AREAS = new Set(["backend", "frontend", "fullstack"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "unreleased.md")
    .sort();
}

/**
 * Check every entry in a directory.
 *
 * `bareVersionOnly` is the public rule: the stem must be exactly the version,
 * because it is the published URL.
 */
export function checkEntryDir(dir: string, opts: { bareVersionOnly: boolean }): EntryProblem[] {
  const problems: EntryProblem[] = [];

  for (const name of listMarkdown(dir)) {
    const stem = name.slice(0, -3);
    const parsed = parseEntryStem(stem);
    if (!parsed) {
      problems.push({
        file: name,
        problem: opts.bareVersionOnly
          ? "filename must be <version>.md, e.g. 1.2.3.md"
          : "filename must be <version>-<topic>.md with a lowercase hyphenated topic, e.g. 1.2.3-union-dues.md",
      });
      continue;
    }
    if (opts.bareVersionOnly && parsed.suffix) {
      problems.push({
        file: name,
        problem: "public entries are the published URL and must be named <version>.md",
      });
    }
    if (!opts.bareVersionOnly && !parsed.suffix && !LEGACY_BARE_DEV_STEMS.has(stem)) {
      problems.push({
        file: name,
        problem:
          "a bare <version>.md name is what makes parallel branches collide; name it <version>-<topic>.md, e.g. 1.2.3-union-dues.md",
      });
    }

    const raw = fs.readFileSync(path.join(dir, name), "utf-8");
    const { data } = parseFrontmatter(raw);

    for (const field of REQUIRED_FIELDS) {
      if (!asString(data[field])) {
        problems.push({ file: name, problem: `missing frontmatter field "${field}"` });
      }
    }

    const version = asString(data.version);
    if (version && version !== parsed.version) {
      problems.push({
        file: name,
        problem: `frontmatter version "${version}" does not match filename version "${parsed.version}"`,
      });
    }

    const date = asString(data.date);
    if (date && !DATE_RE.test(date)) {
      problems.push({ file: name, problem: `date "${date}" is not YYYY-MM-DD` });
    }

    for (const badge of asStringArray(data.badges)) {
      if (badge && !BADGES.has(badge)) {
        problems.push({ file: name, problem: `unknown badge "${badge}"` });
      }
    }
    for (const area of asStringArray(data.areas)) {
      if (area && !AREAS.has(area)) {
        problems.push({ file: name, problem: `unknown area "${area}"` });
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

/** Every version already used by a dev entry, newest last. */
export function usedDevVersions(): string[] {
  return listMarkdown(DEV_POSTS_DIR)
    .map((name) => parseEntryStem(name.slice(0, -3))?.version)
    .filter((v): v is string => Boolean(v));
}

export const ENTRY_DIRS = [
  { dir: DEV_POSTS_DIR, label: "dev", bareVersionOnly: false },
  { dir: PUBLIC_POSTS_DIR, label: "public", bareVersionOnly: true },
];
