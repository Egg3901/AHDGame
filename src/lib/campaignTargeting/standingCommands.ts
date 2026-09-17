/**
 * Standing targeted ads spend personal campaign resources on regional exposure.
 * Purchases need no candidacy; one character revision serializes all buyers and
 * their bonuses persist across races while decaying through the shared rules.
 */
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { applyStandingAdSpend, AD_SPEND_CONFLICT, AD_SPEND_INSUFFICIENT } from "./adSpend";
import { getGameTime } from "@/lib/time/gameTime";
import { assertStandingAdRegion } from "./regions";
import { quoteAdAudience } from "./adQuote";
import { AD_ACTION_COST, planAdPurchase, type CampaignTarget } from "./rules";

export type StandingAdRequest = CampaignTarget & {
  stateId: string;
  count: number;
  quote: { turn: number; cost: number; revision: number };
};

export async function quoteStandingAds(db: Db, character: Character, stateId: string, count = 1) {
  const regions = await assertStandingAdRegion(db, character, stateId);
  const time = await getGameTime();
  return {
    ...(await quoteAdAudience(
      db,
      character.countryId,
      stateId,
      character.policies,
      character.targetedAds ?? [],
      character.targetedAdsRevision ?? 0,
      time.currentTurn,
      count
    )),
    regions: regions.map((region) => ({ id: region._id, name: region.name })),
  };
}

export async function purchaseStandingAds(
  db: Db,
  owner: Character,
  payer: Character,
  request: StandingAdRequest,
  opts?: { idempotencyKey?: string }
) {
  const current = await db.collection<Character>("characters").findOne({ _id: owner._id });
  if (!current) throw notFound("Character not found");
  if (current.countryId !== payer.countryId)
    throw forbidden("Advertiser and payer must be in the same country");
  const quote = await quoteStandingAds(db, current, request.stateId, request.count);
  const target = quote.targets.find(
    (target) => target.dimension === request.dimension && target.bucket === request.bucket
  );
  if (
    !target ||
    request.count > target.maxCount ||
    request.count < 1 ||
    request.count > quote.maxCount
  )
    throw badRequest("Invalid target or action count");
  const ads = planAdPurchase(current.targetedAds ?? [], request, quote.currentTurn, request.count);
  if (!ads) throw conflict("This target is already at the ad bonus cap");
  const funds = target.cost * request.count;
  if (
    request.quote.turn !== quote.currentTurn ||
    request.quote.cost !== funds ||
    request.quote.revision !== quote.revision
  )
    throw conflict("The ad quote changed. Refresh before buying.");
  const actions = AD_ACTION_COST * request.count;
  const fundsField = quote.forex ? "currencyBalances.campaign" : "funds";
  const ownerFilter = {
    _id: current._id,
    targetedAdsRevision: current.targetedAdsRevision ?? { $exists: false },
  };
  const debitFilter = { _id: payer._id, actions: { $gte: actions }, [fundsField]: { $gte: funds } };
  if (current._id.equals(payer._id)) {
    // Single-document atomic purchase: the debit and the inventory write
    // commit in one update, so there is no partial state to reconcile and no
    // money-flow migration applies.
    const result = await db.collection<Character>("characters").updateOne(
      { ...ownerFilter, ...debitFilter },
      {
        $set: { targetedAds: ads },
        $inc: { targetedAdsRevision: 1, actions: -actions, [fundsField]: -funds },
      }
    );
    if (!result.modifiedCount)
      throw conflict("Resources or ad purchases changed. Refresh before buying");
  } else {
    // Crash-safe spend (issue #1672): the payer debit is a keyed idempotent
    // leg and the owner inventory write a guarded keyed update, so a crash
    // between the sequential writes reconciles instead of charging for ads
    // that never landed (or landing them twice). `Idempotency-Key` replays
    // the stored outcome without charging again.
    try {
      await applyStandingAdSpend(db, {
        target: {
          kind: "character",
          ownerDocId: current._id,
          ads,
          guardFilter: {
            targetedAdsRevision: current.targetedAdsRevision ?? { $exists: false },
          },
        },
        payerId: payer._id,
        costFunds: funds,
        costActions: actions,
        fundsField,
        fingerprint: [
          payer._id.toHexString(),
          current._id.toHexString(),
          request.stateId,
          request.dimension,
          request.bucket,
          request.count,
          request.quote.turn,
          funds,
          request.quote.revision,
        ].join(":"),
        ...(opts?.idempotencyKey !== undefined ? { idempotencyKey: opts.idempotencyKey } : {}),
      });
    } catch (error) {
      const message = (error as Error).message;
      if (message.startsWith(AD_SPEND_INSUFFICIENT)) {
        throw conflict("Insufficient personal actions or campaign funds");
      }
      if (message.startsWith(AD_SPEND_CONFLICT)) {
        throw conflict("Ad purchases changed. Refresh before buying");
      }
      throw error;
    }
  }
  return {
    success: true,
    cost: funds,
    actions,
    bonus: ads.find(
      (ad) =>
        ad.stateId === request.stateId &&
        ad.dimension === request.dimension &&
        ad.bucket === request.bucket
    )?.bonus,
  };
}
