/**
 * Campaign managers buy standing ads for a player or campaign-bound ads for an
 * NPP. Player purchases share the character revision with the Actions page,
 * and authorized managers spend their own personal resources.
 */

import { ObjectId, type Db, type ClientSession } from "mongodb";
import { COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS } from "@/lib/constants/countries";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { Campaign, Character, Election, ElectionCandidate, NPP } from "@/lib/db/types";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { isCampaignManagerUser, isCampaignNomineeUser } from "@/lib/campaigns/access";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameTime } from "@/lib/time/gameTime";
import { quoteAdAudience } from "./adQuote";
import { quoteStandingAds, purchaseStandingAds } from "./standingCommands";
import { AD_ACTION_COST, planAdPurchase, usesCampaignRules, type CampaignTarget } from "./rules";

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
  stateId: string,
  count = 1
) {
  const { election, candidate, time } = context;
  if (!candidate.isNPP) {
    const owner = await db
      .collection<Character>("characters")
      .findOne({ _id: candidate.characterId });
    if (!owner) throw notFound("Candidate not found");
    return quoteStandingAds(db, owner, stateId, count);
  }

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
  const owner =
    candidate.isNPP && candidate.nppId
      ? await db
          .collection<NPP>("npps")
          .findOne(
            { _id: candidate.nppId },
            { projection: { "policies.economic": 1, "policies.social": 1, homeState: 1 } }
          )
      : await db
          .collection<Character>("characters")
          .findOne({ _id: candidate.characterId }, { projection: { policies: 1, homeState: 1 } });
  if (!owner) throw notFound("Candidate not found");
  if (!["president", "uachtaran"].includes(election.electionType) && stateId !== owner.homeState)
    throw forbidden("Target the candidate’s home state. Other states require a presidential race.");
  return quoteAdAudience(
    db,
    election.countryId,
    stateId,
    owner.policies,
    candidate.targetedAds ?? [],
    candidate.targetedAdsRevision ?? 0,
    time.currentTurn,
    count
  );
}

export async function purchaseTargetedAds(
  db: Db,
  campaignId: ObjectId,
  user: Actor,
  request: CampaignTarget & {
    stateId: string;
    count: number;
    quote: { turn: number; cost: number; revision: number };
  }
) {
  const context = await loadTargetedAdContext(db, campaignId, user);
  if (!context.candidate.isNPP) {
    const owner = await db
      .collection<Character>("characters")
      .findOne({ _id: context.candidate.characterId });
    if (!owner) throw notFound("Candidate not found");
    return purchaseStandingAds(db, owner, user.character, request);
  }

  const quote = await quoteTargetedAds(db, context, request.stateId, request.count);
  if (!quote.enabled) throw badRequest(quote.message);
  const target = quote.targets.find(
    (t) => t.dimension === request.dimension && t.bucket === request.bucket
  );
  if (!target || request.count > target.maxCount || request.count > quote.maxCount)
    throw badRequest("Invalid target or action count");
  const ads = planAdPurchase(
    context.candidate.targetedAds ?? [],
    request,
    context.time.currentTurn,
    request.count
  );
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
    bonus: ads.find(
      (ad) =>
        ad.stateId === request.stateId &&
        ad.dimension === request.dimension &&
        ad.bucket === request.bucket
    )?.bonus,
  };
}
