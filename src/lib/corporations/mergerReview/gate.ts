/**
 * The merger-review gate: does this deal need clearance, does it already have
 * it, and if it needs one, open the referral.
 *
 * Two call sites use this, and they use it the same way:
 *  - `executeAgreedAcquisition`, the moment an agreed deal would commit
 *  - the hostile-takeover route, the moment a squeeze-out would commit
 *
 * Both are the instant two corporations become one. Reviewing at share-purchase
 * time would be earlier and wronger: until the absorption the two firms still
 * hold their market positions separately, and the engine measures them
 * separately.
 *
 * A CLEARED review is durable for that (acquirer, target) pair, which is what
 * lets a referred hostile takeover simply be retried once the authority signs
 * off, instead of needing the whole 780-line squeeze-out re-entered from a
 * decision handler.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { MergerReview, MergerReviewTrigger } from "@/lib/db/types/mergerReview";
import { getGameState } from "@/lib/gameState";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { getEnactedLevel } from "@/lib/politicalLegislation/enactedLevels";
import type { LawCountryId } from "@/lib/politicalLegislation/types";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import { createNotification } from "@/lib/notifications";
import { computeMergerConcentration } from "./concentration";
import { resolveMergerAuthority } from "./authority";
import { ANTITRUST_LAW_BY_COUNTRY, MERGER_REVIEW_TURNS, thresholdForLevel } from "./constants";

export const MERGER_REVIEWS = "mergerReviews";

/**
 * A corporation under an OVERDUE divestiture order cannot open new
 * acquisitions. Checked at the propose/initiate step rather than at execution,
 * so the block is visible before anyone commits to a price. Still-current
 * orders do not bar anything — only ignoring the deadline does.
 */
export function acquisitionsBarredByDivestiture(
  acquirer: Pick<Corporation, "pendingDivestiture">,
  currentTurn: number
): string | null {
  const obligation = acquirer.pendingDivestiture;
  if (!obligation || currentTurn <= obligation.dueTurn) return null;
  return `This corporation is under an overdue order to divest its ${obligation.sectorType} business and cannot open new acquisitions until it is met.`;
}

export type MergerClearance =
  /** Review does not apply, or the deal is under the threshold. Proceed. */
  | { ok: true; review?: undefined }
  /** A prior review cleared this pair. Proceed; remedy may be attached. */
  | { ok: true; review: MergerReview }
  /** Referred, pending, or blocked. Do not proceed. */
  | { ok: false; error: string; status: number; review: MergerReview };

/**
 * Whether merger review can apply to this pair at all. Ownership and
 * marketization only — never a country list.
 */
async function reviewApplies(db: Db, acquirer: Corporation, target: Corporation): Promise<boolean> {
  // Both sides must be privately owned. A state-owned corp on either side makes
  // the deal an act of the state, not a transaction the state reviews.
  if (acquirer.countryOwnerId || acquirer.ownershipState === "stateOwned") return false;
  if (target.countryOwnerId || target.ownershipState === "stateOwned") return false;

  // Command economy: the state already owns production there, so consolidating
  // two firms is an administrative reorganisation. The feature is inert, which
  // is the correct outcome rather than a gap.
  const blocked = await loadCommandEconomyBlockedCountries(db, [target.countryId]);
  if (blocked.has(target.countryId)) return false;

  return true;
}

/**
 * Evaluate clearance for a deal, opening a referral if one is warranted.
 *
 * Idempotent per pair: a pending review is returned as a block rather than
 * re-referred, and a cleared review short-circuits the whole concentration
 * computation.
 */
export async function assertMergerClearance(
  db: Db,
  acquirer: Corporation,
  target: Corporation,
  trigger: MergerReviewTrigger,
  currentTurn: number
): Promise<MergerClearance> {
  const reviews = db.collection<MergerReview>(MERGER_REVIEWS);

  const existing = await reviews.findOne({
    acquirerCorporationId: acquirer._id,
    targetCorporationId: target._id,
    status: { $in: ["pending", "blocked", "cleared", "clearedWithRemedy"] },
  });
  if (existing) {
    if (existing.status === "cleared" || existing.status === "clearedWithRemedy") {
      return { ok: true, review: existing };
    }
    if (existing.status === "pending") {
      return {
        ok: false,
        status: 409,
        review: existing,
        error: `This merger is under review by the ${existing.countryId} competition authority. A decision is due by turn ${existing.decideByTurn}.`,
      };
    }
    return {
      ok: false,
      status: 400,
      review: existing,
      error: "This merger was blocked by the competition authority and cannot proceed.",
    };
  }

  if (!(await reviewApplies(db, acquirer, target))) return { ok: true };

  const lawId = ANTITRUST_LAW_BY_COUNTRY[target.countryId as LawCountryId];
  if (!lawId) return { ok: true };
  const level = await getEnactedLevel(db, target.countryId as LawCountryId, lawId);
  const threshold = thresholdForLevel(level);
  if (threshold == null) return { ok: true };

  const gameState = await getGameState(db);
  const authority = await resolveMergerAuthority(
    db,
    target.countryId,
    gameState?.currentYear ?? null
  );
  if (!authority) return { ok: true };

  const marketMode = await getMarketSystemModeForDb(db);
  const concentration = await computeMergerConcentration(
    db,
    acquirer,
    target,
    marketAtLeast(marketMode, "plants")
  );
  if (!concentration.leadSectorType || concentration.combinedSharePercent < threshold) {
    return { ok: true };
  }

  const now = new Date();
  const review: MergerReview = {
    _id: new ObjectId(),
    acquirerCorporationId: acquirer._id,
    targetCorporationId: target._id,
    acquirerName: acquirer.name,
    targetName: target.name,
    countryId: target.countryId,
    authoritySeatId: authority.seatId,
    lawLevel: level,
    thresholdPercent: threshold,
    leadSectorType: concentration.leadSectorType,
    combinedSharePercent: concentration.combinedSharePercent,
    overlaps: concentration.overlaps,
    trigger,
    status: "pending",
    openedAtTurn: currentTurn,
    decideByTurn: currentTurn + MERGER_REVIEW_TURNS,
    createdAt: now,
    updatedAt: now,
  };
  await reviews.insertOne(review);

  const notify = (userId: ObjectId, title: string, message: string) =>
    void createNotification({
      userId,
      type: "merger_review_opened",
      title,
      message,
      metadata: {
        mergerReviewId: review._id.toHexString(),
        corporationId: acquirer._id.toHexString(),
      },
    });

  if (authority.holderUserId) {
    notify(
      authority.holderUserId,
      "Merger referred for review",
      `${acquirer.name}'s acquisition of ${target.name} would hold ${concentration.combinedSharePercent}% of the national market. As ${authority.seatName} you have until turn ${review.decideByTurn} to decide.`
    );
  }
  for (const userId of [acquirer.userId, target.userId]) {
    if (userId) {
      notify(
        userId,
        "Merger referred for review",
        `The ${authority.seatName} has referred ${acquirer.name}'s acquisition of ${target.name} for competition review. It cannot complete until cleared.`
      );
    }
  }

  return {
    ok: false,
    status: 409,
    review,
    error: `This merger would hold ${concentration.combinedSharePercent}% of the national market, at or above the ${threshold}% threshold. It has been referred to the ${authority.seatName} and cannot complete until cleared.`,
  };
}
