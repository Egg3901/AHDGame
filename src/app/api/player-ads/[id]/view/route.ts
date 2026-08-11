import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import { handleRouteError } from "@/lib/api/errors";

// POST /api/player-ads/[id]/view — atomically increments the ad's viewCount.
// Public endpoint — no auth required.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ad ID." }, { status: 400 });
    }
    const ads = await getPlayerBannerAdsCollection();
    await ads.updateOne({ _id: new ObjectId(id), isActive: true }, { $inc: { viewCount: 1 } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
