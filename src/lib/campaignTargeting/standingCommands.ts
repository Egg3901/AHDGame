/**
 * Standing targeted ads spend personal campaign resources on regional exposure.
 * Purchases need no candidacy; one character revision serializes all buyers and
 * their bonuses persist across races while decaying through the shared rules.
 */
import { ObjectId, type Db, type ClientSession } from "mongodb";
import type { Character, GameConfig } from "@/lib/db/types";
import { randomUUID } from "node:crypto";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameTime } from "@/lib/time/gameTime";
import { getCampaignCurrency } from "@/lib/campaigns/campaignCurrency";
import { fundPoliticalMediaOrder } from "@/lib/politicalMedia/journal";
import { assertStandingAdRegion } from "./regions";
import { quoteAdAudience } from "./adQuote";
import { AD_ACTION_COST, AD_BOOST_PER_ACTION, planAdPurchase, type CampaignTarget } from "./rules";

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
  request: StandingAdRequest
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
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { politicalMediaMarketEnabled: 1 } });
  if (config?.politicalMediaMarketEnabled === true) {
    const orderId = randomUUID();
    const funding = await fundPoliticalMediaOrder(db, {
      orderId,
      source: "targeted_ad",
      createdTurn: quote.currentTurn,
      countryId: current.countryId ?? "US",
      targetStateId: request.stateId,
      payer: {
        collection: "characters",
        documentId: payer._id,
        path: fundsField,
        currencyCode: quote.forex ? getCampaignCurrency(current.countryId ?? "US") : "AHD",
        localPerAnchor: quote.rate,
        amountLocal: funds,
        currentActions: payer.actions ?? 0,
        actionCost: actions,
      },
      details: {
        effect: {
          kind: "targeted_ad",
          targetCollection: "characters",
          targetDocumentId: current._id.toString(),
          targetDocumentIdIsObjectId: current._id instanceof ObjectId,
          ad: {
            stateId: request.stateId,
            dimension: request.dimension,
            bucket: request.bucket,
            bonus: AD_BOOST_PER_ACTION * request.count,
            lastPurchaseTurn: quote.currentTurn,
          },
        },
        targetDimension: request.dimension,
        targetBucket: request.bucket,
        requestedCount: request.count,
        candidateId: current._id.toString(),
      },
    });
    if (funding.status !== "applied")
      throw conflict("Resources changed before the funded ad order could be placed");
    return { success: true, pending: true, orderId, cost: funds, actions };
  }
  const ownerFilter = {
    _id: current._id,
    targetedAdsRevision: current.targetedAdsRevision ?? { $exists: false },
  };
  const debitFilter = { _id: payer._id, actions: { $gte: actions }, [fundsField]: { $gte: funds } };
  const write = async (session?: ClientSession) => {
    const result = await db
      .collection<Character>("characters")
      .updateOne(
        ownerFilter,
        { $set: { targetedAds: ads }, $inc: { targetedAdsRevision: 1 } },
        { session }
      );
    if (!result.modifiedCount) throw conflict("Ad purchases changed. Refresh before buying");
  };
  const debit = async (session?: ClientSession) => {
    const result = await db
      .collection<Character>("characters")
      .updateOne(debitFilter, { $inc: { actions: -actions, [fundsField]: -funds } }, { session });
    if (!result.modifiedCount) throw conflict("Insufficient personal actions or campaign funds");
  };
  if (current._id.equals(payer._id)) {
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
    await runWithOptionalTransaction(
      async (session) => {
        await debit(session);
        await write(session);
      },
      async () => {
        await debit();
        try {
          await write();
        } catch (error) {
          await db
            .collection<Character>("characters")
            .updateOne({ _id: payer._id }, { $inc: { actions, [fundsField]: funds } });
          throw error;
        }
      }
    );
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
