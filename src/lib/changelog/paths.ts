import path from "path";

export const CHANGELOG_ROOT = path.join(process.cwd(), "content", "changelog");

export const LEGACY_PUBLIC_PATH = path.join(CHANGELOG_ROOT, "legacy", "PUBLIC_CHANGELOG.md");
export const LEGACY_DEV_PATH = path.join(CHANGELOG_ROOT, "legacy", "CHANGELOG.md");

export const PUBLIC_POSTS_DIR = path.join(CHANGELOG_ROOT, "public");
export const DEV_POSTS_DIR = path.join(CHANGELOG_ROOT, "dev");

/** Versions at or above this use the post feed; below use legacy monolith. */
export const POST_FEED_CUTOFF = "0.4.0";
