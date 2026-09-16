import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import { handleRouteError } from "@/lib/api/errors";
import { getAuthUser } from "@/lib/auth";
import {
  PLAYER_AD_IMPRESSION_WINDOW_MS,
  PLAYER_AD_VIEW_LIMITS,
  rateLimitResponse,
} from "@/lib/api/rateLimit";
import { durableRateLimit, mongoRateLimit } from "@/lib/api/rateLimit.mongo";
import { clientIpFromRequest } from "@/lib/utils/network";

// POST /api/player-ads/[id]/view — records one counted impression of an ad.
//
// Public endpoint (anonymous page views are legitimate impressions), guarded
// by two layered gates so rotation cannot be gamed by looping POSTs:
//
// - Velocity: durable per-viewer cap across all ad ids. Bounds tight loops.
// - Impression idempotency: one counted view per ad per viewer per window.
//   Repeats return success without incrementing, so inflating a rival ad
//   collapses to 1/hour per identity while legitimate display is unchanged.
//
// The viewer identity is the authenticated user when a session exists, else
// the client IP. Keying on both (never one alone) means neither logging out
// nor rotating IPs alone resets the gates.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ad ID." }, { status: 400 });
    }

    const authUser = await getAuthUser().catch(() => null);
    const viewerKey = authUser?.userId
      ? `user:${authUser.userId}`
      : `ip:${clientIpFromRequest(req)}`;

    const velocity = await durableRateLimit(
      `player-ad-view:${viewerKey}`,
      PLAYER_AD_VIEW_LIMITS.maxRequests,
      PLAYER_AD_VIEW_LIMITS.windowMs
    );
    if (!velocity.ok) return rateLimitResponse(velocity.retryAfter, undefined, velocity);

    let counted = true;
    try {
      const impression = await mongoRateLimit(
        `player-ad-view-imp:${id}:${viewerKey}`,
        1,
        PLAYER_AD_IMPRESSION_WINDOW_MS
      );
      counted = impression.ok;
    } catch {
      // Storage hiccup: fail open to counting so ad display keeps working.
      counted = true;
    }
    if (!counted) return NextResponse.json({ success: true, counted: false });

    const ads = await getPlayerBannerAdsCollection();
    await ads.updateOne({ _id: new ObjectId(id), isActive: true }, { $inc: { viewCount: 1 } });
    return NextResponse.json({ success: true, counted: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
