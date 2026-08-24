import { unstable_cache } from "next/cache";
import type { Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { WikiPage } from "@/lib/db/types";
import { playerWikiStarter, partyWikiStarter, corporationWikiStarter } from "./playerPages";

/**
 * Player, party and corporation wiki pages are created pre-filled with a starter
 * template. Many are never edited, so the published page is an empty scaffold of
 * section headings and instructions to the owner. Google's AdSense review cited
 * low value content while eight of these were indexed, including five reading
 * "Write your biography here".
 *
 * A page still carrying its untouched starter is not content, so it is excluded
 * from the sitemap and served noindex. The same applies to a page with less than
 * a short paragraph of readable text. It flips back automatically when the owner
 * adds meaningful content, with no admin step.
 */

/** The italic first line each starter emits. Cheap prefilter for the Mongo query. */
const STARTER_MARKERS = [
  "_Write your biography here.",
  "_Party-maintained profile page.",
  "_Company-maintained page.",
] as const;

/**
 * Compare on the body below the H1. The heading carries the entity name, so it
 * differs per page while the scaffold underneath is identical.
 */
function scaffoldOf(markdown: string): string {
  return markdown
    .replace(/^\s*#\s+.*$/m, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const STARTER_SCAFFOLDS = new Set(
  [playerWikiStarter(""), partyWikiStarter(""), corporationWikiStarter("")].map(scaffoldOf)
);

const MIN_INDEXABLE_TEXT_LENGTH = 160;
const MAX_SHORT_PAGE_CANDIDATE_LENGTH = 1_000;

/** True when the page is empty or still exactly its unedited starter template. */
export function isStarterStub(content: string | null | undefined): boolean {
  const scaffold = scaffoldOf(String(content ?? ""));
  if (!scaffold) return true;
  return STARTER_SCAFFOLDS.has(scaffold);
}

function readableTextOf(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`|~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a published page is too incomplete to submit to search engines. */
export function isLowValueWikiContent(content: string | null | undefined): boolean {
  const markdown = String(content ?? "");
  return isStarterStub(markdown) || readableTextOf(markdown).length < MIN_INDEXABLE_TEXT_LENGTH;
}

async function loadLowValueWikiSlugs(): Promise<string[]> {
  const db = await getDb();
  // Starter markers find untouched scaffolds. The raw-length expression adds
  // obvious one-line pages without loading every full wiki article.
  const candidateFilter: Filter<WikiPage> = {
    status: "published",
    $or: [
      ...STARTER_MARKERS.map((marker) => ({
        content: { $regex: escapeRegex(marker) },
      })),
      {
        $expr: {
          $lt: [{ $strLenCP: { $ifNull: ["$content", ""] } }, MAX_SHORT_PAGE_CANDIDATE_LENGTH],
        },
      },
    ],
  };
  const candidates = await db
    .collection<WikiPage>("wikiPages")
    .find(candidateFilter, { projection: { slug: 1, content: 1 } })
    .toArray();

  return candidates.filter((page) => isLowValueWikiContent(page.content)).map((page) => page.slug);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Slugs whose wiki page is not ready for search. Cached on the same 120s
 * revalidate as the other wiki loaders so the sitemap and page metadata agree.
 */
export const getLowValueWikiSlugs = unstable_cache(
  loadLowValueWikiSlugs,
  ["wiki-low-value-pages"],
  { revalidate: 120 }
);
