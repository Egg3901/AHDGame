import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";
import type { MergerReview } from "@/lib/db/types/mergerReview";
import { MERGER_REVIEWS } from "@/lib/corporations/mergerReview/gate";
import { resolveMergerAuthority } from "@/lib/corporations/mergerReview/authority";
import { getGameState } from "@/lib/gameState";
import { autoResolveDecision } from "@/lib/corporations/mergerReview/constants";

export interface MergerReviewSummary {
  id: string;
  acquirerName: string;
  targetName: string;
  countryId: string;
  seatName: string;
  leadSectorType: string;
  combinedSharePercent: number;
  thresholdPercent: number;
  status: MergerReview["status"];
  openedAtTurn: number;
  decideByTurn: number;
  /**
   * What the deadline will do if nobody decides. Published deliberately: a
   * fallback the player cannot see is indistinguishable from a coin flip.
   */
  defaultDecision: string;
  remedySectorType?: string;
  decisionNote?: string;
}

/**
 * GET: the CORPORATION side of merger review, and only that side.
 *
 * Reviews touching a corporation the viewer runs, decided or not, so a CEO can
 * see why a deal is stuck. The officeholder's national queue is a different
 * job with a different reader and lives at `/api/merger-reviews/queue`; it is
 * deliberately not in this payload, so running a corporation never reveals
 * pending referrals against anyone else.
 */
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const userId = new ObjectId(auth.user.userId);

    const [myCorps, gameState] = await Promise.all([
      db
        .collection<Corporation>("corporations")
        .find({ userId })
        .project<{ _id: ObjectId }>({ _id: 1 })
        .toArray(),
      getGameState(db),
    ]);

    const myCorpIds = myCorps.map((c) => c._id);
    if (myCorpIds.length === 0) return NextResponse.json({ involving: [] });

    const involvingDocs = await db
      .collection<MergerReview>(MERGER_REVIEWS)
      .find({
        $or: [
          { acquirerCorporationId: { $in: myCorpIds } },
          { targetCorporationId: { $in: myCorpIds } },
        ],
      })
      .sort({ createdAt: -1 })
      .limit(25)
      .toArray();

    // Seat names are era-resolved per country; cache one lookup per country.
    const seatNameByCountry = new Map<string, string>();
    for (const review of involvingDocs) {
      if (seatNameByCountry.has(review.countryId)) continue;
      const resolved = await resolveMergerAuthority(
        db,
        review.countryId,
        gameState?.currentYear ?? null
      );
      seatNameByCountry.set(review.countryId, resolved?.seatName ?? review.authoritySeatId);
    }

    const involving: MergerReviewSummary[] = involvingDocs.map((review) => ({
      id: review._id.toString(),
      acquirerName: review.acquirerName,
      targetName: review.targetName,
      countryId: review.countryId,
      seatName: seatNameByCountry.get(review.countryId) ?? review.authoritySeatId,
      leadSectorType: review.leadSectorType,
      combinedSharePercent: review.combinedSharePercent,
      thresholdPercent: review.thresholdPercent,
      status: review.status,
      openedAtTurn: review.openedAtTurn,
      decideByTurn: review.decideByTurn,
      defaultDecision: autoResolveDecision(review.combinedSharePercent, review.thresholdPercent),
      ...(review.remedySectorType ? { remedySectorType: review.remedySectorType } : {}),
      ...(review.decisionNote ? { decisionNote: review.decisionNote } : {}),
    }));

    return NextResponse.json({ involving });
  } catch (error) {
    return handleRouteError(error);
  }
}
