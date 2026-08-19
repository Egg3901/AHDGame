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
 * The last day on which a bare `<version>.md` dev entry is accepted.
 *
 * Grandfathering has to survive other pull requests landing: any hardcoded list
 * of accepted stems goes stale the moment a branch that was cut before this one
 * merges, and then someone has to hand-patch the list. Deriving the set from git
 * history is not an option either, because CI checks out at depth 1, so no
 * earlier commit is present to compare against.
 *
 * The entry's own frontmatter date is the stable signal. Every entry already
 * carries one, it is committed alongside the file, and it does not move when
 * branches merge in a different order. An entry authored on or before the cutoff
 * keeps its bare name; anything dated after it must carry a topic suffix. The
 * grandfathered set therefore shrinks on its own as time passes, with nothing to
 * maintain.
 */
export const BARE_NAME_CUTOFF_DATE = "2026-08-19";

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
    const raw = fs.readFileSync(path.join(dir, name), "utf-8");
    const { data } = parseFrontmatter(raw);

    if (opts.bareVersionOnly && parsed.suffix) {
      problems.push({
        file: name,
        problem: "public entries are the published URL and must be named <version>.md",
      });
    }
    for (const damage of frontmatterDamage(raw)) {
      problems.push({ file: name, problem: damage });
    }

    const entryDate = asString(data.date);
    if (
      !opts.bareVersionOnly &&
      !parsed.suffix &&
      !(entryDate && entryDate <= BARE_NAME_CUTOFF_DATE)
    ) {
      problems.push({
        file: name,
        problem: `a bare <version>.md name is what makes parallel branches collide; entries dated after ${BARE_NAME_CUTOFF_DATE} must be named <version>-<topic>.md, e.g. 1.2.3-union-dues.md`,
      });
    }

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

    if (entryDate && !DATE_RE.test(entryDate)) {
      problems.push({ file: name, problem: `date "${entryDate}" is not YYYY-MM-DD` });
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
