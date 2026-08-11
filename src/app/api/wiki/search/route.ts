import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import type { WikiPage } from "@/lib/db/types";

// GET /api/wiki/search — Searches published wiki pages by title, description, content, and optional tag filters.
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

    const results = await wikiPages
      .find(filter)
      .project({ slug: 1, title: 1, description: 1, tags: 1, featured: 1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
