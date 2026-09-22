/**
 * Regenerates src/lib/seeds/wiki/lastUpdated.generated.ts: a slug -> YYYY-MM-DD map
 * derived from the git history of each wiki page's content file, so the "Updated"
 * badge always reflects the last real content change instead of a hand-maintained date.
 *
 * Run: npx tsx scripts/generate-wiki-last-updated.ts
 * Re-run whenever wiki content changes (wired into lint-staged for src/lib/seeds/wiki).
 */
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..");
const WIKI_DIR = path.join(ROOT, "src/lib/seeds/wiki");
const PAGES_DIR = path.join(WIKI_DIR, "pages");
const CONTENT_DIR = path.join(WIKI_DIR, "content");
const OUT_FILE = path.join(WIKI_DIR, "lastUpdated.generated.ts");
const COUNTRIES_DIR = path.join(ROOT, "src/lib/countries");

/**
 * Directories that may DECLARE a wiki page's content.
 *
 * ⚠️ A COUNTRY'S WIKI CONTENT MOVES INTO ITS FOLDER, AND THIS HAS TO FOLLOW IT.
 * Scanning only `seeds/wiki/content/` was right while every page lived there.
 * Once `jpOverview.ts` became a re-export shim onto
 * `countries/jp/wiki/overview.ts`, the shim had no `export const` for the regex
 * below to find, so `jpOverviewContent` resolved to nothing.
 *
 * That did not fail. It fell through to the second pass, which dates an
 * unresolved slug from the PAGE file that declares it -- and so the "Updated"
 * badge on Japan's overview silently started tracking `pages/countries.ts`,
 * a file that has nothing to do with Japan's text. Player-visible copy, quietly
 * wrong, with the generator printing one warning and exiting 0.
 *
 * The fallback is still right for the pages it was written for: `commodity-*`
 * and friends are built programmatically and genuinely have no content file.
 * It is wrong for a page whose content simply moved, which is why an unresolved
 * content VARIABLE is now fatal -- see the check after the scan.
 */
function contentDirs(): string[] {
  const dirs = [CONTENT_DIR];
  for (const entry of readdirSync(COUNTRIES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const wiki = path.join(COUNTRIES_DIR, entry.name, "wiki");
    if (existsSync(wiki)) dirs.push(wiki);
  }
  return dirs;
}

// Map exported content const name -> content file path
const exportToFile = new Map<string, string>();
for (const dir of contentDirs()) {
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const src = readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/export const (\w+)/g)) {
      exportToFile.set(m[1], path.join(path.relative(ROOT, dir).replace(/\\/g, "/"), file));
    }
  }
}

/**
 * The last commit that actually CHANGED this file's text.
 *
 * ⚠️ `--follow --diff-filter=AM`, not a plain `git log -1`, and both halves earn
 * their place.
 *
 * `--follow` walks through renames, so moving a page's content does not sever it
 * from its own history. `--diff-filter=AM` keeps additions and modifications and
 * drops pure renames, so a move does not read as an edit.
 *
 * Without them, relocating Japan's overview into its country folder reset the
 * page's "Updated" badge to the date of the move -- claiming to players that the
 * text had just changed when not one word had. The badge exists to say when the
 * CONTENT last changed; a file that was carried from one directory to another
 * has not changed. With twenty-three more countries' wiki pages due to move into
 * folders, the plain form would have bumped every one of them at once.
 *
 * `A` is kept so a page that has only ever been added still has a date; dropping
 * it would leave every new page unresolved.
 *
 * COST: `--follow` is inherently single-file, so this is one `git log` per page
 * and roughly 0.28s each against 0.12s for the plain form -- about 55s for 185
 * pages, up from about 21s. That is a real cost in a pre-commit hook, and it was
 * accepted rather than optimised away: batching it means parsing `--name-status`
 * output and tracking rename chains by hand, and the failure mode of getting
 * that subtly wrong is a plausible-looking wrong date on a player-facing badge.
 * The hook only fires when a wiki page changes. If it does become a problem,
 * cache by blob hash rather than dropping `--follow`.
 */
function lastCommitDate(repoRelPath: string): string | null {
  try {
    const out = execFileSync(
      "git",
      [
        "log",
        "--follow",
        "--diff-filter=AM",
        "-1",
        "--format=%ad",
        "--date=format:%Y-%m-%d",
        "--",
        repoRelPath,
      ],
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

const dateCache = new Map<string, string | null>();
const slugToDate: Record<string, string> = {};
let missing = 0;
/** Slugs whose page names a content variable that no scanned file declares. */
const unresolvedContent: string[] = [];

for (const file of readdirSync(PAGES_DIR)) {
  if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
  const src = readFileSync(path.join(PAGES_DIR, file), "utf8");
  // Pair each slug with the content identifier in the same page object literal.
  for (const m of src.matchAll(/slug:\s*"([^"]+)"[\s\S]*?content:\s*(\w+)/g)) {
    const [, slug, contentVar] = m;
    const contentFile = exportToFile.get(contentVar);
    if (!contentFile) {
      unresolvedContent.push(`${slug} (${contentVar})`);
      continue;
    }
    if (!dateCache.has(contentFile)) dateCache.set(contentFile, lastCommitDate(contentFile));
    const date = dateCache.get(contentFile);
    if (date) slugToDate[slug] = date;
    else {
      missing++;
      console.warn(`no git date for slug ${slug} (${contentFile})`);
    }
  }
}

// Programmatically generated pages (e.g. commodity-*) have no per-slug content
// file. Import the real page list and date any slug the static scan missed from
// the registration file that declares it (matched by slug literal or, failing
// that, the commodities builder file).
import { WIKI_SEED_PAGES } from "../src/lib/seeds/wiki/pages";
const pageFiles = readdirSync(PAGES_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => path.join("src/lib/seeds/wiki/pages", f));
for (const page of WIKI_SEED_PAGES) {
  if (slugToDate[page.slug]) continue;
  const declaring =
    pageFiles.find((f) => readFileSync(path.join(ROOT, f), "utf8").includes(`"${page.slug}"`)) ??
    "src/lib/seeds/wiki/pages/commodities.ts";
  if (!dateCache.has(declaring)) dateCache.set(declaring, lastCommitDate(declaring));
  const date = dateCache.get(declaring);
  if (date) slugToDate[page.slug] = date;
  else missing++;
}

const entries = Object.entries(slugToDate)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([slug, date]) => `  "${slug}": "${date}",`)
  .join("\n");

writeFileSync(
  OUT_FILE,
  `// AUTO-GENERATED by scripts/generate-wiki-last-updated.ts. Do not edit by hand.\n` +
    `// slug -> date of the last git commit that touched the page's content file.\n` +
    `export const WIKI_LAST_UPDATED: Record<string, string> = {\n${entries}\n};\n`
);

// `npx` on Windows is `npx.cmd`, which `execFileSync` cannot spawn without a
// shell — so this threw ENOENT and failed the pre-commit hook for anyone
// editing a wiki page on Windows. Resolve prettier's own entry point and run it
// through the SAME node binary instead: no shell, no PATH lookup, no
// platform-specific extension, and no shell-quoting question about a repo path
// containing spaces.
execFileSync(
  process.execPath,
  [createRequire(import.meta.url).resolve("prettier/bin/prettier.cjs"), "--write", OUT_FILE],
  { cwd: ROOT }
);

console.log(
  `wrote ${Object.keys(slugToDate).length} slugs to ${path.relative(ROOT, OUT_FILE)}${missing ? `, ${missing} unresolved` : ""}`
);

/**
 * ⚠️ A PAGE NAMING A CONTENT VARIABLE NOBODY DECLARES IS FATAL, NOT A WARNING.
 *
 * This used to print one line and exit 0, and the slug then picked up a date
 * from the page file that registered it. The number produced looks exactly like
 * a real answer -- a plausible recent date, in the right format, in a generated
 * file nobody reads -- while tracking a file that has nothing to do with the
 * page's text. That is a worse failure than crashing, because it ships.
 *
 * It is thrown after the file is written so the diff is available to look at;
 * the commit is what gets blocked.
 */
if (unresolvedContent.length > 0) {
  console.error(
    `\n${unresolvedContent.length} wiki page(s) name a content variable that no content ` +
      `directory declares:\n` +
      unresolvedContent.map((s) => `  ${s}`).join("\n") +
      `\n\nIf the content moved into a country folder, put it under ` +
      `src/lib/countries/<cc>/wiki/ so contentDirs() finds it. A re-export shim ` +
      `has no \`export const\` and cannot be scanned, so the date would silently ` +
      `fall back to the page file that registers the slug.\n`
  );
  process.exit(1);
}
