/**
 * Print the GitHub release title or body for a version.
 *
 * Usage:
 *   npx tsx scripts/changelog/release-body.ts 1.6.0
 *   npx tsx scripts/changelog/release-body.ts 1.6.0 --title
 *
 * The public post is preferred because it is the copy written for readers. A
 * release with no public post (an internal-only cut) falls back to the dev
 * post, so a tag never ships with an empty body.
 */
import fs from "fs";
import path from "path";
import { parseFrontmatter, asString } from "../../src/lib/changelog/frontmatter";
import { DEV_POSTS_DIR, PUBLIC_POSTS_DIR } from "../../src/lib/changelog/paths";
import { getSiteUrl } from "../../src/lib/siteMetadata";

function read(dir: string, version: string): { title: string; body: string } | null {
  const file = path.join(dir, `${version}.md`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf-8");
  const { data, content } = parseFrontmatter(raw);
  return { title: asString(data.title), body: content.trim() };
}

function main(): void {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: release-body.ts <version> [--title]");
    process.exit(1);
  }

  const post = read(PUBLIC_POSTS_DIR, version) ?? read(DEV_POSTS_DIR, version);
  if (!post) {
    console.error(`No changelog post for ${version} in content/changelog/{public,dev}/.`);
    process.exit(1);
  }

  if (process.argv.includes("--title")) {
    console.log(post.title || version);
    return;
  }
  console.log(post.body);
  console.log("");
  console.log(`Full notes: ${getSiteUrl()}/changelog/${version}`);
}

main();
