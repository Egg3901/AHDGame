/**
 * Standing targeted ads spend personal campaign resources on regional exposure.
 * Purchases need no candidacy; one character revision serializes all buyers and
 * their flights persist across races while decaying through the shared rules.
 */
import type { Db, ClientSession } from "mongodb";
import type { Character, State } from "@/lib/db/types";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameTime } from "@/lib/time/gameTime";
import { quoteAdAudience } from "./adQuote";
import { AD_ACTION_COST, planAdPurchase, type CampaignTarget } from "./rules";

export type StandingAdRequest = CampaignTarget & {
  stateId: string;
  turns: number;
  quote: { turn: number; cost: number; revision: number };
};

export async function quoteStandingAds(db: Db, character: Character, stateId: string) {
  const region = await db
    .collection<State>("states")
    .findOne({ _id: stateId, countryId: character.countryId }, { projection: { _id: 1 } });
  if (!region) throw badRequest("Choose a region in your country");
  const time = await getGameTime();
  return quoteAdAudience(
    db,
    character.countryId,
    stateId,
    character.policies,
    character.targetedAds ?? [],
    character.targetedAdsRevision ?? 0,
    time.currentTurn
  );
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
  const quote = await quoteStandingAds(db, current, request.stateId);
  const target = quote.targets.find(
    (target) => target.dimension === request.dimension && target.bucket === request.bucket
  );
  if (!target || request.turns < 1 || request.turns > quote.maxFlightTurns)
    throw badRequest("Invalid target or flight length");
  const ads = planAdPurchase(current.targetedAds ?? [], request, quote.currentTurn, request.turns);
  if (!ads) throw conflict("This target already has an ad buy scheduled for this turn");
  const funds = target.cost * request.turns;
  if (
    request.quote.turn !== quote.currentTurn ||
    request.quote.cost !== funds ||
    request.quote.revision !== quote.revision
  )
    throw conflict("The ad quote changed. Refresh before buying.");
  const actions = AD_ACTION_COST * request.turns;
  const fundsField = quote.forex ? "currencyBalances.campaign" : "funds";
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
    scheduledThrough: quote.currentTurn + request.turns - 1,
  };
}
