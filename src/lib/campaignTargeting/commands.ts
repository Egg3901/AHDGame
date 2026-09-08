/**
 * Targeted ads belong to an election candidate. Managers and nominees buy
 * regional flights with personal campaign funds and actions; every buyer shares
 * the same candidate's per-target pacing limit in purchaseTargetedAds.
 */

import { loadCampaignCurrencyRates } from "@/lib/campaigns/campaignCurrency";
import { ObjectId, type Db, type ClientSession } from "mongodb";
import { COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS } from "@/lib/constants/countries";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { Campaign, Character, Election, ElectionCandidate, NPP } from "@/lib/db/types";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { isCampaignManagerUser, isCampaignNomineeUser } from "@/lib/campaigns/access";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameTime } from "@/lib/time/gameTime";
import { loadCampaignAudience } from "./audience";
import {
  AD_ACTION_COST,
  adPurchaseCost,
  adExposure,
  planAdPurchase,
  targetAudience,
  targetedAdBonuses,
  usesCampaignRules,
  type CampaignTarget,
} from "./rules";

type Actor = AuthUserWithCharacter & { hasCharacter: true; character: Character };

export async function loadTargetedAdContext(db: Db, campaignId: ObjectId, user: Actor) {
  const campaign = await db.collection<Campaign>("campaigns").findOne({ _id: campaignId });
  if (!campaign) throw notFound("Campaign not found");
  if (
    !isCampaignManagerUser(campaign, user.userId) &&
    !(await isCampaignNomineeUser(db, campaign, user.userId, user.character._id))
  )
    throw forbidden("Not authorized");
  const [election, candidate, time] = await Promise.all([
    db.collection<Election>("elections").findOne({ _id: campaign.electionId }),
    db.collection<ElectionCandidate>("electionCandidates").findOne({
      electionId: campaign.electionId,
      characterId: campaign.candidateId,
      status: "active",
    }),
    getGameTime(),
  ]);
  if (!election || !candidate) throw notFound("Active candidate not found");
  if (election.countryId !== user.character.countryId)
    throw forbidden("Campaign is in another country");
  if (
    campaign.status === "archived" ||
    candidate.campaignSuspended ||
    election.status !== "active" ||
    (election.endTurn != null && time.currentTurn >= election.endTurn) ||
    (election.startTurn != null && time.currentTurn < election.startTurn)
  )
    throw badRequest("Campaign is not accepting actions");
  return { campaign, election, candidate, time };
}

export async function quoteTargetedAds(
  db: Db,
  context: Awaited<ReturnType<typeof loadTargetedAdContext>>,
  stateId: string
) {
  const { election, candidate, time } = context;
  if (!usesCampaignRules(election))
    return {
      enabled: false as const,
      targets: [],
      message: "This race keeps its original campaign rules. Targeted ads open with new races.",
    };
  if (
    election.electionType === "president" &&
    COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS.has(election.countryId)
  )
    return {
      enabled: false as const,
      targets: [],
      message:
        "This presidential contest uses party organization rather than demographic vote allocation. Targeted ads are unavailable.",
    };
  if (election.state !== stateId && election.state !== election.countryId)
    throw forbidden("That region is outside this election");
  const audience = await loadCampaignAudience(db, election.countryId, stateId);
  if (!audience) throw badRequest("This region has no targetable electorate");
  const owner =
    candidate.isNPP && candidate.nppId
      ? await db
          .collection<NPP>("npps")
          .findOne(
            { _id: candidate.nppId },
            { projection: { "policies.economic": 1, "policies.social": 1 } }
          )
      : await db
          .collection<Character>("characters")
          .findOne({ _id: candidate.characterId }, { projection: { policies: 1 } });
  if (!owner) throw notFound("Candidate not found");
  const position = { economicLean: owner.policies.economic, socialLean: owner.policies.social };
  const forex = await isForexEnabled();
  const campaignRates = await loadCampaignCurrencyRates(db);
  const rate = forex ? campaignLocalRate(election.countryId, campaignRates) : 1;
  const ads = candidate.targetedAds ?? [];
  const unique = new Map<string, CampaignTarget>();
  for (const cell of audience.cells)
    for (const [dimension, bucket] of Object.entries(cell.buckets))
      unique.set(`${dimension}:${bucket}`, { dimension, bucket });
  const current = targetedAdBonuses(audience.cells, position, ads, stateId, time.currentTurn);
  const targets = [...unique.values()].map((target) => {
    const info = targetAudience(audience.cells, target)!;
    const planned = planAdPurchase(ads, { ...target, stateId }, time.currentTurn, 1);
    const after = targetedAdBonuses(
      audience.cells,
      position,
      planned ?? ads,
      stateId,
      time.currentTurn
    );
    const mean = (bonuses: Record<string, number>) =>
      audience.cells.reduce(
        (sum, cell) =>
          sum +
          (cell.buckets[target.dimension] === target.bucket
            ? (cell.share * (bonuses[cell.id] ?? 0)) / info.share
            : 0),
        0
      );
    const active = ads.find(
      (ad) =>
        ad.stateId === stateId && ad.dimension === target.dimension && ad.bucket === target.bucket
    );
    return {
      ...target,
      audienceShare: info.share,
      eligibleAudience: Math.round(audience.context.statePopulation * info.share),
      cohesion: info.cohesion,
      cost: adPurchaseCost(audience.context.statePopulation, info.share, 1) * rate,
      currentBonus: mean(current),
      afterBonus: mean(after),
      exposure: active ? adExposure(active, time.currentTurn) : 0,
      scheduledThrough: active?.throughTurn ?? null,
      available: planned !== null,
    };
  });
  return {
    enabled: true as const,
    targets,
    actionCost: AD_ACTION_COST,
    currentTurn: time.currentTurn,
    revision: candidate.targetedAdsRevision ?? 0,
    maxFlightTurns: Math.max(
      0,
      Math.min(12, (election.endTurn ?? time.currentTurn + 1) - time.currentTurn)
    ),
    stateId,
    forex,
    rate,
  };
}

export async function purchaseTargetedAds(
  db: Db,
  campaignId: ObjectId,
  user: Actor,
  request: CampaignTarget & {
    stateId: string;
    turns: number;
    quote: { turn: number; cost: number; revision: number };
  }
) {
  const context = await loadTargetedAdContext(db, campaignId, user);
  const quote = await quoteTargetedAds(db, context, request.stateId);
  if (!quote.enabled) throw badRequest(quote.message);
  const target = quote.targets.find(
    (t) => t.dimension === request.dimension && t.bucket === request.bucket
  );
  if (!target || request.turns > quote.maxFlightTurns)
    throw badRequest("Invalid target or flight length");
  const ads = planAdPurchase(
    context.candidate.targetedAds ?? [],
    request,
    context.time.currentTurn,
    request.turns
  );
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
  const candidateFilter = {
    _id: context.candidate._id,
    status: "active" as const,
    campaignSuspended: { $ne: true },
    targetedAdsRevision: context.candidate.targetedAdsRevision ?? { $exists: false },
  };
  const debit = async (session?: ClientSession) => {
    const result = await db
      .collection<Character>("characters")
      .updateOne(
        { _id: user.character._id, actions: { $gte: actions }, [fundsField]: { $gte: funds } },
        { $inc: { actions: -actions, [fundsField]: -funds } },
        { session }
      );
    if (!result.modifiedCount) throw conflict("Insufficient personal actions or campaign funds");
  };
  const write = async (session?: ClientSession) => {
    const result = await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateOne(
        candidateFilter,
        { $set: { targetedAds: ads }, $inc: { targetedAdsRevision: 1 } },
        { session }
      );
    if (!result.modifiedCount) throw conflict("Campaign changed. Refresh before buying ads");
  };
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
          .updateOne({ _id: user.character._id }, { $inc: { actions, [fundsField]: funds } });
        throw error;
      }
    }
  );
  return {
    success: true,
    cost: funds,
    actions,
    scheduledThrough: context.time.currentTurn + request.turns - 1,
  };
}
