import { NextResponse } from "next/server";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import { handleRouteError } from "@/lib/api/errors";

// GET /api/player-ads/next — returns the active ad with the lowest viewCount.
// Public endpoint — no auth required.
export async function GET() {
  try {
    const ads = await getPlayerBannerAdsCollection();
    // Only admin-approved ads may serve publicly (Google ads share these
    // pages). Legacy docs without moderationStatus predate the gate and are
    // grandfathered as approved.
    const ad = await ads.findOne(
      {
        isActive: true,
        $or: [{ moderationStatus: "approved" }, { moderationStatus: { $exists: false } }],
      },
      {
        sort: { viewCount: 1, createdAt: 1 },
        projection: {
          _id: 1,
          imageUrl: 1,
          linkUrl: 1,
          altText: 1,
          characterName: 1,
          viewCount: 1,
        },
      }
    );

    if (!ad) {
      return NextResponse.json({ ad: null });
    }

    return NextResponse.json({
      ad: {
        _id: ad._id.toString(),
        imageUrl: ad.imageUrl,
        linkUrl: ad.linkUrl ?? null,
        altText: ad.altText ?? null,
        characterName: ad.characterName,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
