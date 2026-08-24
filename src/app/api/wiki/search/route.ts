import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { rankWikiSearchCandidates, type WikiSearchCandidate } from "@/lib/wiki/wikiSearch";
import { getNonPageWikiSearchCandidates } from "@/lib/wiki/wikiSearchSources";
import type { WikiPage } from "@/lib/db/types";

/**
 * Ranking needs more candidates than it returns: the best title match may not
 * be among the first `limit` documents the database happens to hand back.
 */
const CANDIDATE_POOL_MULTIPLIER = 5;
const MAX_CANDIDATE_POOL = 100;

// GET /api/wiki/search — Searches every wiki surface: published pages plus the
// generated party/seat/office/election pages, category indexes and learning paths.
// Auth: public (private pages excluded for non-admins); blocked when wiki is disabled
// Errors: 403
export async function GET(request: Request) {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    const tags = searchParams.get("tags")?.split(",").filter(Boolean) || [];
    const rawLimit = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 20 : rawLimit, 1), 50);

    const user = await getAuthUser().catch(() => null);
    const isAdmin = user?.isAdmin === true;

    const db = await getDb();
    const wikiPages = db.collection<WikiPage>("wikiPages");

    // Build filter — exclude private pages for non-admins
    const filter: Record<string, unknown> = { status: "published" };
    if (!isAdmin) {
      filter.private = { $ne: true };
    }

    if (tags.length > 0) {
      filter.tags = { $in: tags };
    }

    if (query) {
      const escaped = escapeRegex(query);
      filter.$or = [
        { title: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { content: { $regex: escaped, $options: "i" } },
      ];
    }

    const poolSize = Math.min(limit * CANDIDATE_POOL_MULTIPLIER, MAX_CANDIDATE_POOL);

    // Only pages carry tags, so a tag-filtered search is by definition a search
    // of authored pages — the generated surfaces cannot satisfy it.
    const includeNonPageSurfaces = tags.length === 0;

    const [pageDocs, nonPageCandidates] = await Promise.all([
      wikiPages
        .find(filter)
        .project({ slug: 1, title: 1, description: 1, tags: 1, featured: 1 })
        .limit(poolSize)
        .toArray(),
      includeNonPageSurfaces
        ? // Degrade to authored pages rather than failing the whole search: the
          // generated surfaces aggregate several collections, and a hiccup there
          // should not cost the caller the page results we already have.
          getNonPageWikiSearchCandidates().catch((err) => {
            console.error("[wiki] generated-surface search candidates failed:", err);
            return [] as WikiSearchCandidate[];
          })
        : Promise.resolve([] as WikiSearchCandidate[]),
    ]);

    const pageCandidates: WikiSearchCandidate[] = pageDocs.map((doc) => {
      const page = doc as unknown as {
        slug: string;
        title: string;
        description?: string;
        tags?: string[];
        featured?: boolean;
      };
      return {
        slug: page.slug,
        title: page.title,
        description: page.description,
        href: `/wiki/${page.slug}`,
        kind: "page",
        tags: page.tags,
        featured: page.featured,
        // The filter above already matched title, description or content, so a
        // document whose title and description do not match matched its body.
        // Flagging it lets ranking place body hits last without projecting the
        // full article text on every keystroke.
        matchedBody: true,
      };
    });

    const results = rankWikiSearchCandidates(
      query,
      [...pageCandidates, ...nonPageCandidates],
      limit
    );

    return NextResponse.json({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
