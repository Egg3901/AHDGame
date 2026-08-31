import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { withNoStore } from "@/lib/api/withNoStore";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { MergerReview } from "@/lib/db/types/mergerReview";
import { MERGER_REVIEWS } from "@/lib/corporations/mergerReview/gate";
import { resolveMergerAuthority } from "@/lib/corporations/mergerReview/authority";
import { getGameState } from "@/lib/gameState";
import { getEnactedLevel } from "@/lib/politicalLegislation/enactedLevels";
import { carriedLawIdFor } from "@/lib/politicalLegislation/carriedLaw";
import type { LawCountryId } from "@/lib/politicalLegislation/types";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import {
  ANTITRUST_LAW_BY_COUNTRY,
  MERGER_REVIEW_BLOCK_MARGIN_PERCENT,
  MERGER_REVIEW_REMEDY_MARGIN_PERCENT,
  autoResolveDecision,
  thresholdForLevel,
} from "@/lib/corporations/mergerReview/constants";
import type { MergerReviewSummary } from "../route";

/**
 * The OFFICEHOLDER surface: the national referral queue for the seat the
 * viewer holds, plus the referrals that seat has already decided.
 *
 * This is national work, not corporation work, which is why it is its own
 * endpoint rather than a second array bolted onto the CEO payload. Running a
 * corporation must never reveal pending referrals against other firms.
 *
 * Authorization re-resolves the seat from `cabinetMembers` on every request and
 * trusts nothing from the client: whoever holds the seat NOW decides, and a
 * minister who was reshuffled out this turn loses the queue with the seat.
 *
 * Fails closed. A country whose era has no such seat, or whose economy is a
 * command economy, has no queue and reports `applies: false` so the caller
 * renders NOTHING rather than an empty state implying a feature that does not
 * apply here.
 */
async function handleGET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const userId = new ObjectId(auth.user.userId);

    const [character, gameState] = await Promise.all([
      db
        .collection<Character>("characters")
        .findOne({ userId }, { projection: { _id: 1, countryId: 1 } }),
      getGameState(db),
    ]);
    if (!character?.countryId) return NextResponse.json({ applies: false });

    const authority = await resolveMergerAuthority(
      db,
      character.countryId,
      gameState?.currentYear ?? null
    );
    // No seat in this country, or not in this era: nothing to surface.
    if (!authority) return NextResponse.json({ applies: false });

    // The seat, re-resolved server-side, is the whole authorization.
    const holdsSeat = Boolean(
      authority.holderCharacterId && authority.holderCharacterId.equals(character._id)
    );
    if (!holdsSeat) return NextResponse.json({ applies: false });

    // Command economy: the state already owns production, so there is nothing
    // to referee and no queue to work.
    const blocked = await loadCommandEconomyBlockedCountries(db, [
      authority.countryId as CountryId,
    ]);
    if (blocked.has(authority.countryId as CountryId)) return NextResponse.json({ applies: false });

    const reviews = db.collection<MergerReview>(MERGER_REVIEWS);
    const [pendingDocs, decidedDocs] = await Promise.all([
      reviews
        .find({ status: "pending", countryId: authority.countryId })
        .sort({ decideByTurn: 1 })
        .toArray(),
      reviews
        .find({ countryId: authority.countryId, status: { $ne: "pending" } })
        .sort({ resolvedAtTurn: -1, createdAt: -1 })
        .limit(25)
        .toArray(),
    ]);

    // At "No Enforcement" nothing new can be referred. The surface still opens
    // if referrals opened under a stricter law are still pending, so repealing
    // the law never strands a referral with nobody able to decide it.
    // Same carried-law resolution the gate uses: a merge survivor can hold an
    // absorbed state's competition statute with no entry of its own, and this
    // surface must read the law that actually armed the referrals — otherwise
    // the authority who can decide them is told enforcement is dead.
    const lawId =
      ANTITRUST_LAW_BY_COUNTRY[authority.countryId as CountryId] ??
      (await carriedLawIdFor(db, authority.countryId, Object.values(ANTITRUST_LAW_BY_COUNTRY)));
    const level = lawId ? await getEnactedLevel(db, authority.countryId as LawCountryId, lawId) : 0;
    const enforcementLive = thresholdForLevel(level) != null;
    if (!enforcementLive && pendingDocs.length === 0) return NextResponse.json({ applies: false });

    const toSummary = (review: MergerReview): MergerReviewSummary => ({
      id: review._id.toString(),
      acquirerName: review.acquirerName,
      targetName: review.targetName,
      countryId: review.countryId,
      seatName: authority.seatName,
      leadSectorType: review.leadSectorType,
      combinedSharePercent: review.combinedSharePercent,
      thresholdPercent: review.thresholdPercent,
      status: review.status,
      openedAtTurn: review.openedAtTurn,
      decideByTurn: review.decideByTurn,
      defaultDecision: autoResolveDecision(review.combinedSharePercent, review.thresholdPercent),
      ...(review.remedySectorType ? { remedySectorType: review.remedySectorType } : {}),
      ...(review.decisionNote ? { decisionNote: review.decisionNote } : {}),
    });

    return NextResponse.json({
      applies: true,
      seatName: authority.seatName,
      countryId: authority.countryId,
      enforcementLive,
      pending: pendingDocs.map(toSummary),
      decided: decidedDocs.map(toSummary),
      bands: {
        remedyMarginPercent: MERGER_REVIEW_REMEDY_MARGIN_PERCENT,
        blockMarginPercent: MERGER_REVIEW_BLOCK_MARGIN_PERCENT,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withNoStore(handleGET);
