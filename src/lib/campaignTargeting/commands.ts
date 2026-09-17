/**
 * Campaign managers buy standing ads for a player or campaign-bound ads for an
 * NPP. Player purchases share the character revision with the Actions page,
 * and authorized managers spend their own personal resources.
 */

import { ObjectId, type Db } from "mongodb";
import { COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS } from "@/lib/constants/countries";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { Campaign, Character, Election, ElectionCandidate, NPP } from "@/lib/db/types";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api/errors";
import { isCampaignManagerUser, isCampaignNomineeUser } from "@/lib/campaigns/access";
import { applyTargetedAdSpend, AD_SPEND_CONFLICT, AD_SPEND_INSUFFICIENT } from "./adSpend";
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
  },
  opts?: { idempotencyKey?: string }
) {
  const context = await loadTargetedAdContext(db, campaignId, user);
  if (!context.candidate.isNPP) {
    const owner = await db
      .collection<Character>("characters")
      .findOne({ _id: context.candidate.characterId });
    if (!owner) throw notFound("Candidate not found");
    return purchaseStandingAds(db, owner, user.character, request, opts);
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
  // Crash-safe spend (issue #1672): the payer debit is a keyed idempotent
  // leg and the candidate inventory write a guarded keyed update, so a crash
  // between the sequential writes reconciles instead of charging for ads
  // that never landed (or landing them twice). `Idempotency-Key` replays the
  // stored outcome without charging again.
  try {
    await applyTargetedAdSpend(db, {
      target: {
        kind: "candidate",
        ownerDocId: context.candidate._id,
        ads,
        guardFilter: {
          status: "active" as const,
          campaignSuspended: { $ne: true },
          targetedAdsRevision: context.candidate.targetedAdsRevision ?? { $exists: false },
        },
      },
      payerId: user.character._id,
      costFunds: funds,
      costActions: actions,
      fundsField,
      fingerprint: [
        user.character._id.toHexString(),
        context.candidate._id.toHexString(),
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
      throw conflict("Campaign changed. Refresh before buying ads");
    }
    throw error;
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
