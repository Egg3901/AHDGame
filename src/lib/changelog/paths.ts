import path from "path";

export const CHANGELOG_ROOT = path.join(process.cwd(), "content", "changelog");

export const LEGACY_PUBLIC_PATH = path.join(CHANGELOG_ROOT, "legacy", "PUBLIC_CHANGELOG.md");
export const LEGACY_DEV_PATH = path.join(CHANGELOG_ROOT, "legacy", "CHANGELOG.md");

export const PUBLIC_POSTS_DIR = path.join(CHANGELOG_ROOT, "public");
export const DEV_POSTS_DIR = path.join(CHANGELOG_ROOT, "dev");

/**
 * Notes waiting for a release to carry them.
 *
 * A pull request writes one file here and never touches a version number. The
 * release script folds every note in this directory into a single dev post and
 * empties it. Nothing in this directory is published, so a note sitting here is
 * shipped code that has not been released yet, which is exactly what it should
 * mean.
 */
export const UNRELEASED_DIR = path.join(CHANGELOG_ROOT, "unreleased");

/** Versions at or above this use the post feed; below use legacy monolith. */
export const POST_FEED_CUTOFF = "0.4.0";
