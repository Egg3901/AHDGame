import fs from "fs";
import path from "path";
import { asString, asStringArray, parseFrontmatter } from "./frontmatter";
import { DEV_POSTS_DIR, PUBLIC_POSTS_DIR } from "./paths";
import { compareVersionsDesc } from "./postUtils";
import type { ChangelogBadge, ChangelogPost, DevArea } from "./types";

const BADGE_VALUES = new Set<ChangelogBadge>(["major", "patch", "hotfix"]);
const AREA_VALUES = new Set<DevArea>(["backend", "frontend", "fullstack"]);

function parsePostFile(filePath: string): ChangelogPost | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = parseFrontmatter(raw);
  const version = asString(data.version);
  const date = asString(data.date);
  const title = asString(data.title);

  if (!version || !date || !title) return null;

  const badges = asStringArray(data.badges).filter((b): b is ChangelogBadge =>
    BADGE_VALUES.has(b as ChangelogBadge)
  );
  const areas = asStringArray(data.areas).filter((a): a is DevArea =>
    AREA_VALUES.has(a as DevArea)
  );

  return {
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
    .sort((a, b) => compareVersionsDesc(a.version, b.version) || b.date.localeCompare(a.date));
}

export function loadDevPosts(): ChangelogPost[] {
  return listPostFiles(DEV_POSTS_DIR)
    .map(parsePostFile)
    .filter((p): p is ChangelogPost => p !== null)
    .sort((a, b) => compareVersionsDesc(a.version, b.version) || b.date.localeCompare(a.date));
}

export function loadPublicPost(version: string): ChangelogPost | null {
  const filePath = path.join(PUBLIC_POSTS_DIR, `${version}.md`);
  if (!fs.existsSync(filePath)) return null;
  return parsePostFile(filePath);
}
