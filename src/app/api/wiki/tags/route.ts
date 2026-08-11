import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkWikiDisabled } from "@/lib/api/wikiGuard";
import type { WikiPage, SystemTag } from "@/lib/db/types";

// GET /api/wiki/tags — Returns all system tags and player-created tags with page counts for published wiki pages.
// Auth: public; blocked when wiki is disabled
// Errors: 403
export async function GET() {
  try {
    const blocked = await checkWikiDisabled();
    if (blocked) return blocked;
    const db = await getDb();

    // Get system tags
    const systemTagsCol = db.collection<SystemTag>("systemTags");
    const systemTagsRaw = await systemTagsCol.find({}).sort({ order: 1 }).toArray();

    // Count pages per system tag
    const wikiPages = db.collection<WikiPage>("wikiPages");
    const systemTags = await Promise.all(
      systemTagsRaw.map(async (tag) => {
        const count = await wikiPages.countDocuments({
          status: "published",
          private: { $ne: true },
          tags: tag._id,
        });
        return { ...tag, count };
      })
    );

    // Get player tags (distinct non-system tags from published pages)
    const allTags = await wikiPages.distinct("tags", { status: "published" });
    const systemTagIds = systemTags.map((t) => t._id);
    const playerTagStrings = allTags.filter(
      (tag): tag is string => typeof tag === "string" && !systemTagIds.includes(tag)
    );

    // Count player tags
    const playerTags = await Promise.all(
      playerTagStrings.map(async (tag) => {
        const count = await wikiPages.countDocuments({
          status: "published",
          private: { $ne: true },
          tags: tag,
        });
        return { tag, count };
      })
    );

    return NextResponse.json({ systemTags, playerTags });
  } catch (error) {
    return handleRouteError(error);
  }
}
