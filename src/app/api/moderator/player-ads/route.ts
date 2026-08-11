import { NextResponse } from "next/server";
import { requireModerator } from "@/lib/api/requireModerator";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import { handleRouteError } from "@/lib/api/errors";

// GET /api/moderator/player-ads — list banner ads for moderation review, paginated, newest first.
// Query params: ?offset=0&limit=25
// Auth: requireModerator
// Errors: 403
export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)));

    const ads = await getPlayerBannerAdsCollection();
    const all = await ads
      .find({}, { sort: { createdAt: -1 } })
      .skip(offset)
      .limit(limit + 1) // fetch one extra to detect hasMore
      .toArray();

    const hasMore = all.length > limit;
    const results = all.slice(0, limit);

    return NextResponse.json({
      ads: results.map((ad) => ({
        _id: ad._id.toString(),
        characterName: ad.characterName,
        countryId: ad.countryId,
        imageUrl: ad.imageUrl,
        linkUrl: ad.linkUrl ?? null,
        altText: ad.altText ?? null,
        viewCount: ad.viewCount,
        isActive: ad.isActive,
        createdAt: ad.createdAt.toISOString(),
        costPaid: ad.costPaid,
        currencyCode: ad.currencyCode,
      })),
      hasMore,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
