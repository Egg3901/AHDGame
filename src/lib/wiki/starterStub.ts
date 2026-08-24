import { unstable_cache } from "next/cache";
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
 * from the sitemap and served noindex. It flips back the moment the owner saves
 * anything of their own, with no admin step.
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

/** True when the page is empty or still exactly its unedited starter template. */
export function isStarterStub(content: string | null | undefined): boolean {
  const scaffold = scaffoldOf(String(content ?? ""));
  if (!scaffold) return true;
  return STARTER_SCAFFOLDS.has(scaffold);
}

async function loadStarterStubSlugs(): Promise<string[]> {
  const db = await getDb();
  // Only pages that still contain a starter's marker line can be stubs, so the
  // content projection stays on a handful of documents rather than the whole wiki.
  const candidates = await db
    .collection<WikiPage>("wikiPages")
    .find(
      {
        status: "published",
        $or: STARTER_MARKERS.map((marker) => ({
          content: { $regex: escapeRegex(marker) },
        })),
      },
      { projection: { slug: 1, content: 1 } }
    )
    .toArray();

  return candidates.filter((page) => isStarterStub(page.content)).map((page) => page.slug);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Slugs whose wiki page is still an unedited starter. Cached on the same 120s
 * revalidate as the other wiki loaders so the sitemap and page metadata agree.
 */
export const getStarterStubSlugs = unstable_cache(loadStarterStubSlugs, ["wiki-starter-stubs"], {
  revalidate: 120,
});
