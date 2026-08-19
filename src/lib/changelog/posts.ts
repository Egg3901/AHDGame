import fs from "fs";
import path from "path";
import { asString, asStringArray, parseFrontmatter } from "./frontmatter";
import { DEV_POSTS_DIR, PUBLIC_POSTS_DIR } from "./paths";
import { compareVersionsDesc } from "./postUtils";
import { AREA_VALUES, BADGE_VALUES } from "./types";
import type { ChangelogBadge, ChangelogPost, DevArea } from "./types";

const BADGES = new Set<string>(BADGE_VALUES);
const AREAS = new Set<string>(AREA_VALUES);

function parsePostFile(filePath: string): ChangelogPost | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = parseFrontmatter(raw);
  const version = asString(data.version);
  const date = asString(data.date);
  const title = asString(data.title);

  if (!version || !date || !title) return null;

  // Unknown values are dropped rather than thrown, so one bad entry cannot take
  // the whole feed down in production. checkEntryDir is what makes them loud:
  // it fails CI and the pre-commit hook before the entry ever merges.
  const badges = asStringArray(data.badges).filter((b): b is ChangelogBadge => BADGES.has(b));
  const areas = asStringArray(data.areas).filter((a): a is DevArea => AREAS.has(a));

  return {
    // The filename stem. Dev entries add a topic suffix after the version
    // (`1.2.3-union-dues`) so two branches never write the same path; see
    // entryFiles.ts. Ordering and grouping come from the frontmatter below, not
    // from this name.
    slug: path.basename(filePath, ".md"),
    version,
    date,
    title,
    summary: asString(data.summary),
    tags: asStringArray(data.tags),
    badges: badges.length > 0 ? badges : ["patch"],
    era: asString(data.era) || undefined,
    areas: areas.length > 0 ? areas : undefined,
    body: content,
  };
}

function listPostFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "unreleased.md")
    .map((name) => path.join(dir, name));
}

export function loadPublicPosts(): ChangelogPost[] {
  return listPostFiles(PUBLIC_POSTS_DIR)
    .map(parsePostFile)
    .filter((p): p is ChangelogPost => p !== null)
    .sort(
      (a, b) =>
        compareVersionsDesc(a.version, b.version) ||
        b.date.localeCompare(a.date) ||
        a.slug.localeCompare(b.slug)
    );
}

export function loadDevPosts(): ChangelogPost[] {
  return listPostFiles(DEV_POSTS_DIR)
    .map(parsePostFile)
    .filter((p): p is ChangelogPost => p !== null)
    .sort(
      (a, b) =>
        compareVersionsDesc(a.version, b.version) ||
        b.date.localeCompare(a.date) ||
        a.slug.localeCompare(b.slug)
    );
}

export function loadPublicPost(version: string): ChangelogPost | null {
  const filePath = path.join(PUBLIC_POSTS_DIR, `${version}.md`);
  if (!fs.existsSync(filePath)) return null;
  return parsePostFile(filePath);
}
