import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import { handleRouteError } from "@/lib/api/errors";

// GET /api/admin/player-ads — list all banner ads, newest first.
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const ads = await getPlayerBannerAdsCollection();
    const all = await ads.find({}, { sort: { createdAt: -1 } }).toArray();

    return NextResponse.json({
      ads: all.map((ad) => ({
        _id: ad._id.toString(),
        characterName: ad.characterName,
        countryId: ad.countryId,
        imageUrl: ad.imageUrl,
        linkUrl: ad.linkUrl ?? null,
        altText: ad.altText ?? null,
        viewCount: ad.viewCount,
        isActive: ad.isActive,
        // Legacy ads (pre-moderation-gate) have no status and serve as approved.
        moderationStatus: ad.moderationStatus ?? "approved",
        createdAt: ad.createdAt.toISOString(),
        costPaid: ad.costPaid,
        currencyCode: ad.currencyCode,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
