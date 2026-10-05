import {
  loadCampaignCurrencyRates,
  loadCampaignPriceLevel,
  campaignLocalRate,
} from "@/lib/campaigns/campaignCurrency";
import { loadOppositionTargets } from "@/lib/campaigns/oppositionTargets";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { assertSameCountry } from "@/lib/api/sameCountry";
import {
  isCampaignManagerUser,
  isCampaignNomineeUser,
  isCampaignRunningMateUser,
  legacyManagersAsList,
  MAX_CAMPAIGN_MANAGERS,
} from "@/lib/campaigns/access";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { createNotification } from "@/lib/notifications";
import type { Campaign, Character, Election, ElectionCandidate, NPP } from "@/lib/db/types";
import { getCampaignFamilyScalar } from "@/lib/campaigns/upgradeCosts";
import {
  SUPPORT_RALLY_FULL_VALUE,
  SUPPORT_RALLY_ACTION_COST,
  SUPPORT_RALLY_TOUR_TICK_ACTION_COST,
} from "@/lib/electionEngine/electionFormulaFactors";
import { buildRallyAccrualEntry } from "@/lib/turn/elections/supportAccrual";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { ObjectId, type Db } from "mongodb";
import { getGameTime } from "@/lib/time/gameTime";
import { isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";
import {
  CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER,
  CAMPAIGN_STRENGTH_MAX_BATCH_CLICKS,
  campaignStrengthBatchQuote,
  maxAffordableCampaignStrengthClicks,
} from "@/lib/campaigns/campaignStrength";
import { emitRallyWire } from "@/lib/elections/raceWireEmit";
import { CAMPAIGN_ACTIVITY_HISTORY_CAP } from "@/lib/campaigns/constants/activityHistory";

export async function appointCampaignManager(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter;
  managerCharacterId: string | null;
}) {
  const { db, campaignId, user, managerCharacterId } = params;
  const campaign = await getCampaignOrThrow(db, campaignId);
  const isAdmin = user.isAdmin ?? false;
  const isNominee = await isCampaignNomineeUser(
    db,
    campaign,
    user.userId,
    user.character?._id ?? null
  );
  if (!isNominee && !isAdmin) {
    throw forbidden("Only the candidate or an admin may appoint campaign managers");
  }

  const now = new Date();
  const existing = campaign.managers ?? legacyManagersAsList(campaign);

  if (managerCharacterId === null) {
    await db.collection<Campaign>("campaigns").updateOne(
      { _id: campaign._id },
      {
        $set: { managerId: null, managerCharacterId: null, managers: [], updatedAt: now },
      }
    );
    return {
      message: "Campaign managers cleared",
      managerCharacterId: null,
      managerId: null,
      managers: [],
    };
  }

  const managerOid = new ObjectId(managerCharacterId);
  if (managerOid.equals(campaign.candidateId)) {
    throw badRequest("The candidate cannot also be their own campaign manager");
  }

  const managerChar = await db
    .collection<Character>("characters")
    .findOne({ _id: managerOid }, { projection: { _id: 1, name: 1, userId: 1, countryId: 1 } });
  if (!managerChar) {
    throw notFound("Proposed manager character not found");
  }

  const managerElection = await db
    .collection<Election>("elections")
    .findOne({ _id: campaign.electionId }, { projection: { countryId: 1 } });
  if (!managerElection) {
    throw notFound("Election not found");
  }
  assertSameCountry(managerChar, managerElection, {
    message: "Campaign managers must be from the same country as the campaign",
  });

  // Toggle semantics: appointing an existing manager removes them, so one
  // endpoint covers add and remove without a second verb.
  const alreadyIdx = existing.findIndex((m) => m.characterId.equals(managerOid));
  let next: NonNullable<Campaign["managers"]>;
  let message: string;
  if (alreadyIdx >= 0) {
    next = existing.filter((_, i) => i !== alreadyIdx);
    message = `${managerChar.name} removed as campaign manager`;
  } else {
    if (existing.length >= MAX_CAMPAIGN_MANAGERS) {
      throw badRequest(
        `A campaign can have at most ${MAX_CAMPAIGN_MANAGERS} managers. Remove one before appointing another.`
      );
    }
    next = [...existing, { userId: managerChar.userId, characterId: managerOid, appointedAt: now }];
    message = `${managerChar.name} appointed as campaign manager`;
  }

  // Mirror the first manager onto the legacy pair so un-migrated readers and
  // the existing UI still resolve someone, and no backfill is needed.
  const head = next[0] ?? null;
  await db.collection<Campaign>("campaigns").updateOne(
    { _id: campaign._id },
    {
      $set: {
        managers: next,
        managerId: head?.userId ?? null,
        managerCharacterId: head?.characterId ?? null,
        updatedAt: now,
      },
    }
  );

  return {
    message,
    managerCharacterId: head?.characterId?.toString() ?? null,
    managerId: head?.userId?.toString() ?? null,
    managers: next.map((m) => ({
      userId: m.userId.toString(),
      characterId: m.characterId.toString(),
    })),
  };
}

export async function contributeCampaignStrength(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character };
  /**
   * How many single-click contributions to bundle into this one call. `"max"`
   * resolves server-side to the largest count the contributor can pay for right
   * now. Defaults to 1, so callers that predate the batched Support control are
   * unchanged.
   */
  clicks?: number | "max";
}) {
  const { db, campaignId, user, clicks: requestedClicks = 1 } = params;
  const campaignRates = await loadCampaignCurrencyRates(db);
  const strengthPreset = await getGameStatePresetOrDefault(db);
  const priceLevel = await loadCampaignPriceLevel(db);
  const now = new Date();
  const campaign = await getCampaignOrThrow(db, campaignId);
  const election = await db.collection<Election>("elections").findOne({ _id: campaign.electionId });
  const forexEnabled = await isForexEnabled();

  // Phase 5.5: gate matches Campaign Manager eligibility broadly (US president +
  // senate / governor / house / stateSenate; non-US deferred per D4) instead of
  // hard-coding electionType === 'president'. The eligibility check is the
  // single source of truth — see src/lib/campaigns/isCampaignEligible.ts.
  if (!election || !isCampaignEligibleElection(election)) {
    throw badRequest("Campaign strength is not available for this race");
  }
  // UI-honesty gate (issue #2891 bundle): only the presidential engine
  // consumes `campaignStrength` (presidentialElectionEngine strengthMultiplier).
  // Down-ballot engines ignore it entirely, so accepting contributions there
  // would charge players for a stat with zero vote effect. Reject BEFORE any
  // funds/actions debit. Revisit if CS is ever wired into down-ballot engines.
  if (election.electionType !== "president") {
    throw badRequest(
      "Campaign strength only affects presidential races right now, so contributions to this race are disabled to protect your funds and actions."
    );
  }
  if (election.status === "completed") {
    throw badRequest("Election has ended");
  }

  const actorCharacter = user.character;
  assertSameCountry(actorCharacter, election, {
    message: "You cannot contribute campaign strength to a campaign in another country",
  });
  const npi = actorCharacter.nationalInfluence ?? 0;
  const strengthPerClick = npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER;
  if (strengthPerClick <= 0) {
    throw badRequest("You have no national influence to contribute");
  }

  const character = await db
    .collection<Character>("characters")
    .findOne(
      { _id: user.character._id },
      { projection: { actions: 1, funds: 1, countryId: 1, currencyBalances: 1, name: 1 } }
    );
  if (!character) {
    throw notFound("Character not found");
  }
  // The strength-cost formula `√(currentCS + strengthAdded)` is anchor-based;
  // convert to the player's LOCAL currency so the gate, the debit, the error
  // message, and the returned cost are all local (player never sees anchor).
  const homeCurrency = getHomeCurrency(character, strengthPreset);
  // Campaign funds are decoupled from live forex — the strength cost converts at
  // the frozen world-seeded currency basis.
  const campaignRate = forexEnabled
    ? campaignLocalRate(character.countryId ?? "US", campaignRates, strengthPreset)
    : 1;

  const currentCS = campaign.campaignStrength ?? 0;
  const availableLocal = character.currencyBalances?.campaign ?? character.funds ?? 0;
  const fundsRate = (forexEnabled ? campaignRate : 1) * priceLevel;

  // "Max" is resolved HERE, not from the count the client previewed: the funds
  // cost climbs with the campaign's live strength, so any rival contribution
  // between page load and confirm would otherwise turn the player's Max click
  // into a hard "insufficient resources" failure instead of a slightly smaller
  // batch. A numeric count is honoured as asked and simply gated below.
  const clicks =
    requestedClicks === "max"
      ? maxAffordableCampaignStrengthClicks({
          currentStrength: currentCS,
          strengthPerClick,
          availableFunds: availableLocal,
          availableActions: character.actions,
          fundsRate,
        })
      : Number.isFinite(requestedClicks)
        ? Math.min(Math.max(1, Math.floor(requestedClicks)), CAMPAIGN_STRENGTH_MAX_BATCH_CLICKS)
        : 1;

  if (clicks < 1) {
    // Only reachable via "max". Quote a single click so the message says what
    // the player is actually short of rather than just refusing.
    const one = campaignStrengthBatchQuote(currentCS, strengthPerClick, 1);
    const oneCostLocal = one.costFunds * fundsRate;
    throw badRequest(
      character.actions < one.costActions
        ? `Insufficient actions. Need ${one.costActions}, have ${character.actions}`
        : `Insufficient funds. Need ${Math.ceil(oneCostLocal).toLocaleString()}, have ${Math.floor(availableLocal).toLocaleString()}`
    );
  }

  const quote = campaignStrengthBatchQuote(currentCS, strengthPerClick, clicks);
  const strengthAdded = quote.strengthAdded;
  const costFunds = quote.costFunds;
  const costFundsLocal = costFunds * fundsRate;
  const costActions = quote.costActions;
  if (character.actions < costActions) {
    throw badRequest(`Insufficient actions. Need ${costActions}, have ${character.actions}`);
  }
  if (availableLocal < costFundsLocal) {
    throw badRequest(
      `Insufficient funds. Need ${Math.ceil(costFundsLocal).toLocaleString()}, have ${Math.floor(availableLocal).toLocaleString()}`
    );
  }

  // Guard on the canonical local balance — see in-game bug #0553 background.
  const csCampaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
  const targetCandidateId = campaign.candidateId?.toString?.() ?? null;
  const targetCandidate = campaign.candidateId
    ? await db.collection<ElectionCandidate>("electionCandidates").findOne(
        {
          electionId: campaign.electionId,
          characterId: campaign.candidateId,
        },
        { projection: { characterName: 1, party: 1 } }
      )
    : null;
  const targetName = targetCandidate?.characterName ?? targetCandidateId ?? campaignId.toString();
  const auditTurn = await getCurrentTurn(db);

  const charUpdate = await db.collection<Character>("characters").updateOne(
    {
      _id: character._id,
      actions: { $gte: costActions },
      [csCampaignFundsField]: { $gte: costFundsLocal },
    },
    {
      $inc: {
        actions: -costActions,
        [csCampaignFundsField]: -costFundsLocal,
      },
      $set: { updatedAt: now },
    }
  );
  if (charUpdate.matchedCount === 0) {
    throw badRequest("Insufficient resources — may have changed since page load");
  }

  const campaignUpdate = await db.collection<Campaign>("campaigns").updateOne(
    { _id: campaignId },
    {
      $inc: { campaignStrength: strengthAdded },
      $set: { updatedAt: now },
    }
  );
  if (campaignUpdate.matchedCount === 0) {
    await db.collection<Character>("characters").updateOne(
      { _id: character._id },
      {
        $inc: {
          actions: costActions,
          [csCampaignFundsField]: costFundsLocal,
        },
        $set: { updatedAt: now },
      }
    );
    throw notFound("Campaign not found");
  }

  const actorName = character.name ?? user.character.name ?? "Unknown";
  const nextCampaignStrength = currentCS + strengthAdded;
  // Batched contributions are one debit and one audit row, so the row has to
  // say how many clicks it stood in for or the ledger reads as a single
  // implausibly large donation.
  const batchSuffix = clicks > 1 ? ` (x${clicks})` : "";
  void db.collection("activityLog").insertOne({
    type: "game_action",
    timestamp: now,
    userId: new ObjectId(user.userId),
    characterId: character._id,
    characterName: actorName,
    username: user.username,
    countryId: character.countryId,
    actionType: "campaign_strength",
    actionCost: costActions,
    turn: auditTurn,
    targetId: campaignId,
    targetName,
    targetType: "campaign",
    result: {
      success: true,
      fundsChange: -costFundsLocal,
      message: `Added ${strengthAdded.toFixed(1)} campaign strength to ${targetName}${batchSuffix}`,
    },
    summary: `campaign_strength - ${actorName} added ${strengthAdded.toFixed(1)} CS to ${targetName}${batchSuffix}`,
    details: {
      campaignId: campaignId.toString(),
      electionId: campaign.electionId.toString(),
      electionType: election.electionType,
      countryId: election.countryId,
      candidateId: targetCandidateId,
      candidateName: targetName,
      candidateParty: targetCandidate?.party ?? campaign.party,
      clicks,
      strengthPerClick,
      strengthAdded,
      campaignStrengthBefore: currentCS,
      campaignStrengthAfter: nextCampaignStrength,
      costFunds: costFundsLocal,
      costActions,
      currencyCode: homeCurrency,
      fxRate: campaignRate,
      actorNationalInfluence: npi,
    },
  });

  return {
    campaignStrength: nextCampaignStrength,
    /** Click count actually executed: may be below a "max" request's preview. */
    clicks,
    strengthAdded,
    // Local-currency cost (anchor formula × home rate). Unrounded to preserve
    // the existing response precision; UI rounds for display.
    costFunds: costFundsLocal,
    costActions,
    /** Home currency the cost was charged in — clients face-format with this. */
    currencyCode: homeCurrency,
  };
}

/**
 * Notify a character that a rival campaign has begun opposition research on
 * them. Opposition research silently drains the target's favorability
 * (-0.5%/level/turn in campaignTurn.ts) with no other signal — players saw
 * their favorability slide with no idea who or why (support ticket #946). This
 * fires once at targeting time (retarget is cooldown-gated, so no per-turn
 * spam). NPP / unowned targets have no player to notify. Names the source
 * campaign per the ticket's explicit ask to see who is attacking.
 */
export async function notifyOppositionResearchTarget(
  db: Db,
  target: { userId?: ObjectId | null } | null,
  actorName: string
): Promise<void> {
  if (!target?.userId) return;
  await createNotification({
    userId: target.userId,
    type: "player_attack",
    title: "You're under opposition research",
    message: `${actorName}'s campaign has begun opposition research against you. Expect your favorability to take hits (about -0.5% per research level each turn) until it ends — counter it by raising your own campaign's media spending.`,
    metadata: { attackerName: actorName, kind: "opposition_research" },
  });
}

export async function retargetOppositionResearch(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character };
  targetId: string;
}) {
  const { db, campaignId, user, targetId } = params;
  const campaign = await getCampaignOrThrow(db, campaignId);
  await assertCampaignManagerOrNominee(db, campaign, user);

  if (!user.isAdmin) {
    const election = await db
      .collection<Election>("elections")
      .findOne({ _id: campaign.electionId }, { projection: { countryId: 1 } });
    if (!election) {
      throw notFound("Election not found");
    }
    assertSameCountry(user.character, election, {
      message: "You cannot retarget opposition research for a campaign in another country",
    });
  }

  const oppoUnlocked =
    campaign.oppositionResearchTree?.starter || (campaign.oppositionResearchLevel ?? 0) > 0;
  if (!oppoUnlocked) {
    throw badRequest("Opposition research must be purchased before retargeting");
  }
  const now = new Date();
  const currentTurn = await getCurrentTurn(db);
  // Turn-first cooldown (freezes on pause, no wall-clock drift); falls back to
  // the legacy Date for campaigns that pre-date the turn field.
  const onCooldown =
    typeof campaign.oppositionResearchCooldownUntilTurn === "number"
      ? currentTurn < campaign.oppositionResearchCooldownUntilTurn
      : !!campaign.oppositionResearchCooldownUntil &&
        campaign.oppositionResearchCooldownUntil > now;
  if (onCooldown) {
    throw badRequest("Opposition research is on cooldown");
  }

  const targetOid = new ObjectId(targetId);
  const targetChar = await db.collection<Character>("characters").findOne({ _id: targetOid });
  const targetNpp = !targetChar
    ? await db.collection<NPP>("npps").findOne({ _id: targetOid })
    : null;
  const target = targetChar || targetNpp;
  if (!target) {
    throw notFound("Target not found");
  }
  assertSameCountry(user.character, target, {
    message: "You cannot research opposition targets in other countries",
  });

  // Same country is not the rule; the race is. Without this, research could be
  // bought against a private citizen or a senator who is not standing — real
  // money and actions spent to drain somebody the buyer is not running
  // against. The list the picker offers comes from this same function, so the
  // two cannot disagree about who is fair game.
  const raceElection = await db
    .collection<Election>("elections")
    .findOne({ _id: campaign.electionId });
  if (!raceElection) {
    throw notFound("Election not found");
  }
  const eligible = await loadOppositionTargets(
    db,
    raceElection,
    campaign.candidateId,
    await getGameTime()
  );
  if (!eligible.some((t) => t.id === targetOid.toString())) {
    throw badRequest("You can only research a candidate standing against you in this race");
  }

  const targetName: string = target.name;
  const OPPOSITION_RESEARCH_COOLDOWN_TURNS = 6; // 6 turns = 6h at standard cadence
  const cooldownUntil = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const cooldownUntilTurn = currentTurn + OPPOSITION_RESEARCH_COOLDOWN_TURNS;
  await db.collection<Campaign>("campaigns").updateOne(
    { _id: campaignId },
    {
      $set: {
        oppositionTargetId: targetOid,
        oppositionTargetName: targetName,
        oppositionResearchCooldownUntil: cooldownUntil,
        oppositionResearchCooldownUntilTurn: cooldownUntilTurn,
        updatedAt: now,
      },
    }
  );

  // Tell the target they've been put under opposition research (see helper).
  await notifyOppositionResearchTarget(db, targetChar, user.character.name);

  return {
    oppositionTargetId: targetOid.toString(),
    oppositionTargetName: targetName,
    oppositionResearchCooldownUntil: cooldownUntil.toISOString(),
  };
}

export async function resetOppositionResearch(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter;
}) {
  const { db, campaignId, user } = params;
  const campaign = await getCampaignOrThrow(db, campaignId);
  const isAdmin = user.isAdmin || false;
  const isManager = isCampaignManagerUser(campaign, user.userId);
  const isNominee = await isCampaignNomineeUser(
    db,
    campaign,
    user.userId,
    user.character?._id ?? null
  );
  if (!isAdmin && !isManager && !isNominee) {
    throw forbidden("Not authorized");
  }

  // Defense-in-depth: even with a manager/nominee role, the actor's character
  // must be from the same country as the campaign's election. Closes the
  // post-relocation gap where a manager keeps their role across countries.
  if (!isAdmin && user.character) {
    const election = await db
      .collection<Election>("elections")
      .findOne({ _id: campaign.electionId }, { projection: { countryId: 1 } });
    if (!election) {
      throw notFound("Election not found");
    }
    assertSameCountry(user.character, election, {
      message: "You cannot reset opposition research for a campaign in another country",
    });
  }

  if (
    (campaign.oppositionResearchLevel ?? 0) === 0 &&
    !campaign.oppositionResearchTree?.starter &&
    !campaign.oppositionTargetId &&
    !campaign.oppositionTargetName &&
    !campaign.oppositionResearchCooldownUntil
  ) {
    throw badRequest("Opposition research is already cleared");
  }

  const turnNumber = await getCurrentTurn(db);
  const now = new Date();
  const activity: Campaign["activityHistory"][0] = {
    type: "downgrade",
    category: "oppositionResearch",
    newLevel: 0,
    costFunds: 0,
    costActions: 0,
    reason: "reset",
    timestamp: now,
    turnNumber,
  };

  await db.collection<Campaign>("campaigns").updateOne(
    { _id: campaignId },
    {
      $set: {
        oppositionResearchLevel: 0,
        oppositionResearchTree: { starter: false, a: 0, b: 0, c: 0 },
        "publicFogOfWar.oppositionResearchLevel": 0,
        "partyFogOfWar.oppositionResearchLevel": 0,
        oppositionTargetId: null,
        oppositionTargetName: null,
        oppositionResearchCooldownUntil: null,
        oppositionResearchCooldownUntilTurn: null,
        updatedAt: now,
      },
      $push: {
        activityHistory: {
          $each: [activity],
          $slice: -CAMPAIGN_ACTIVITY_HISTORY_CAP,
        },
      },
    }
  );
}

export async function setCampaignColor(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter;
  color: string | null;
}) {
  const { db, campaignId, user, color } = params;
  const campaign = await getCampaignOrThrow(db, campaignId);
  const isManager = isCampaignManagerUser(campaign, user.userId);
  const isAdmin = user.isAdmin ?? false;
  const isNominee = await isCampaignNomineeUser(
    db,
    campaign,
    user.userId,
    user.character?._id ?? null
  );
  if (!isManager && !isNominee && !isAdmin) {
    throw forbidden("Only the candidate, campaign manager, or admin may change the campaign color");
  }

  // Defense-in-depth: even with a manager/nominee role, the actor's character
  // must be from the same country as the campaign's election.
  if (!isAdmin && user.character) {
    const election = await db
      .collection<Election>("elections")
      .findOne({ _id: campaign.electionId }, { projection: { countryId: 1 } });
    if (!election) {
      throw notFound("Election not found");
    }
    assertSameCountry(user.character, election, {
      message: "You cannot change the color of a campaign in another country",
    });
  }

  const now = new Date();
  await db
    .collection<Campaign>("campaigns")
    .updateOne(
      { _id: campaign._id },
      color === null
        ? { $unset: { color: "" }, $set: { updatedAt: now } }
        : { $set: { color, updatedAt: now } }
    );

  return {
    message:
      color === null ? "Campaign color cleared to default" : `Campaign color set to ${color}`,
    color,
  };
}

export async function getCampaignOrThrow(db: Db, campaignId: ObjectId): Promise<Campaign> {
  const campaign = await db.collection<Campaign>("campaigns").findOne({ _id: campaignId });
  if (!campaign) {
    throw notFound("Campaign not found");
  }
  await assertCampaignActiveForManagement(db, campaign);
  return campaign;
}

async function assertCampaignActiveForManagement(db: Db, campaign: Campaign): Promise<void> {
  // Mutation-side fetch: archived campaigns (primary losers / withdrawn) are
  // retained for read-only history (getCampaignDetail still renders them) but
  // cannot be managed — block every upgrade / donate / strength / rally / etc.
  // path here so a bookmarked URL can't keep operating an eliminated campaign.
  if (campaign.status === "archived") {
    throw badRequest("This campaign has been eliminated and can no longer be managed.");
  }

  if (!campaign.candidateIsNPP) {
    const candidateRow = await db.collection<ElectionCandidate>("electionCandidates").findOne(
      {
        electionId: campaign.electionId,
        characterId: campaign.candidateId,
        status: "active",
      },
      { projection: { campaignSuspended: 1 } }
    );
    if (candidateRow?.campaignSuspended) {
      throw badRequest("This campaign is suspended. Management actions are disabled.");
    }
  }
}

export async function assertCampaignManagerOrNominee(
  db: Db,
  campaign: Campaign,
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character }
) {
  const isManager = isCampaignManagerUser(campaign, user.userId);
  const isNominee = await isCampaignNomineeUser(db, campaign, user.userId, user.character._id);
  if (!isManager && !isNominee) {
    throw forbidden("Not authorized");
  }
}

/**
 * Authorize a ticket-surrogate action (rally fire, fundraising upgrade).
 *
 * Defense-in-depth superset of the manager/nominee gate: managers and nominees
 * keep their existing broad access with no phase or race-type restriction (so
 * nothing changes for down-ballot or primary-phase campaigns). It ADDS a third
 * authorized actor, the ticket's running mate, but ONLY on a presidential
 * race that is in its general-election phase, since the running mate is a
 * general-phase presidential concept and has no baseline in any other context.
 *
 * The surrogate spends the SAME campaign pools the nominee already spends
 * (Campaign.actions / funds, lastRallyTurn), so the effect augments the ticket
 * rather than granting a second independent pool.
 */
export async function assertCampaignActorForSurrogate(
  db: Db,
  campaign: Campaign,
  election: Election | null,
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character }
) {
  const isManager = isCampaignManagerUser(campaign, user.userId);
  if (isManager) return;
  const isNominee = await isCampaignNomineeUser(db, campaign, user.userId, user.character._id);
  if (isNominee) return;

  const isRunningMate = await isCampaignRunningMateUser(
    db,
    campaign,
    user.userId,
    user.character._id
  );
  if (!isRunningMate) {
    throw forbidden("Not authorized");
  }
  if (election?.electionType !== "president") {
    throw forbidden("Not authorized");
  }
  const gameTime = await getGameTime();
  if (!isCampaignUpgradeGeneralPhase(election, gameTime.currentTurn, gameTime)) {
    throw badRequest("Running-mate surrogate actions open once the general election begins");
  }
}

export async function getCurrentTurn(db: Db): Promise<number> {
  const gameState = await db
    .collection<{ _id: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" });
  return gameState?.currentTurn ?? 0;
}

/**
 * Fire a one-shot rally event for the campaign's candidate. Per the B1
 * design, 60% of the race-family-scaled `SUPPORT_RALLY_FULL_VALUE` lands
 * immediately on `electionCandidates.support`; the remaining 40% is
 * queued as a `supportAccrual` entry that drips over the next
 * `RALLY_SPREAD_TURNS` turns via the accrual-tick processor.
 *
 * Throttled at one one-shot rally per turn per candidate (via the
 * `lastRallyTurn` field). The tour-tick path (B1.3) does NOT touch
 * `lastRallyTurn` — they're independent rate-limits.
 */
export async function fireRallyOneShot(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character };
}) {
  const { db, campaignId, user } = params;
  const campaign = await getCampaignOrThrow(db, campaignId);

  const now = new Date();
  const election = await db.collection<Election>("elections").findOne({ _id: campaign.electionId });
  if (!election) {
    throw notFound("Election not found");
  }
  // Rally is a ticket-surrogate action: manager/nominee keep broad access, and
  // a presidential general-phase running mate may fire it too. It spends the
  // shared Campaign.actions pool + lastRallyTurn, so a VP fire and a nominee
  // fire share the one-per-turn throttle (augment, not double).
  await assertCampaignActorForSurrogate(db, campaign, election, user);
  if (!user.isAdmin) {
    assertSameCountry(user.character, election, {
      message: "You cannot rally for a campaign in another country",
    });
  }
  if (!isCampaignEligibleElection(election)) {
    throw badRequest("Rallies are not available for this race");
  }
  if (election.status !== "active") {
    throw badRequest("Election is not active");
  }

  const scalar = getCampaignFamilyScalar(election.electionType as string);
  const scaledR = SUPPORT_RALLY_FULL_VALUE * scalar;
  const actionCost = Math.ceil(SUPPORT_RALLY_ACTION_COST * scalar);

  if (campaign.actions < actionCost) {
    throw badRequest(`Insufficient actions. Need ${actionCost}, have ${campaign.actions}`);
  }

  // Lookup the candidate row so we can read prior `support` and
  // `lastRallyTurn` to enforce the one-per-turn throttle.
  const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
    electionId: campaign.electionId,
    characterId: campaign.candidateId,
    status: "active",
  });
  if (!candidate) {
    throw notFound("Candidate not found for this campaign");
  }

  const currentTurn = await getCurrentTurn(db);
  if (typeof candidate.lastRallyTurn === "number" && candidate.lastRallyTurn >= currentTurn) {
    throw badRequest("Rally already fired this turn");
  }

  const { immediateBump, entry } = buildRallyAccrualEntry(scaledR);
  const currentSupport = typeof candidate.support === "number" ? candidate.support : 50;
  const nextSupport = Math.max(0, Math.min(100, currentSupport + immediateBump));

  // Atomic guard: matches actions + lastRallyTurn at read time. If the
  // candidate fired a rally between our read and write (extremely
  // unlikely with rate-limit) the modifiedCount === 0 throws.
  const lastRallyMatch =
    typeof candidate.lastRallyTurn === "number"
      ? { lastRallyTurn: candidate.lastRallyTurn }
      : { lastRallyTurn: { $exists: false } };

  const campaignResult = await db.collection<Campaign>("campaigns").updateOne(
    { _id: campaignId, actions: { $gte: actionCost } },
    {
      $inc: { actions: -actionCost },
      $set: { updatedAt: now },
    }
  );
  if (campaignResult.modifiedCount === 0) {
    throw new ApiError(409, "Campaign actions changed since page load. Please refresh.");
  }

  const candidateResult = await db.collection<ElectionCandidate>("electionCandidates").updateOne(
    { _id: candidate._id, ...lastRallyMatch },
    {
      $set: { support: nextSupport, lastRallyTurn: currentTurn },
      $push: { supportAccrual: entry },
    }
  );
  if (candidateResult.modifiedCount === 0) {
    // Roll back the campaign action deduction.
    await db
      .collection<Campaign>("campaigns")
      .updateOne({ _id: campaignId }, { $inc: { actions: actionCost } });
    throw new ApiError(409, "Rally state changed since page load. Please refresh.");
  }

  // Per-race wire. Fire-and-forget, after both writes have committed.
  void emitRallyWire(db, campaign, immediateBump);

  return {
    immediateBump,
    nextSupport,
    pendingDripPerTurn: entry.amountPerTurn,
    pendingDripTurnsRemaining: entry.turnsRemaining,
    actionsRemaining: campaign.actions - actionCost,
  };
}

/**
 * Toggle the rally-tour for this candidate on or off. While active, the
 * per-turn campaign processor queues a fresh rally event each turn
 * (60%/40% split same as one-shot). Stopping the tour leaves the
 * trailing accrual to fade naturally — does NOT clear queued drips.
 */
export async function setRallyTourActive(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character };
  active: boolean;
}) {
  const { db, campaignId, user, active } = params;
  const campaign = await getCampaignOrThrow(db, campaignId);
  await assertCampaignManagerOrNominee(db, campaign, user);

  const election = await db.collection<Election>("elections").findOne({ _id: campaign.electionId });
  if (!election) {
    throw notFound("Election not found");
  }
  if (!user.isAdmin) {
    assertSameCountry(user.character, election, {
      message: "You cannot manage a rally tour for a campaign in another country",
    });
  }
  if (!isCampaignEligibleElection(election)) {
    throw badRequest("Rallies are not available for this race");
  }

  const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
    electionId: campaign.electionId,
    characterId: campaign.candidateId,
    status: "active",
  });
  if (!candidate) {
    throw notFound("Candidate not found for this campaign");
  }

  if (active) {
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateOne({ _id: candidate._id }, { $set: { rallyTourActive: true } });
  } else {
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateOne({ _id: candidate._id }, { $unset: { rallyTourActive: "" } });
  }

  return { active };
}

// Re-export for the tour-tick processor (B1.3 wires this into
// campaignTurn — see `processCampaignTurn` for the per-turn dispatch).
export const RALLY_TOUR_TICK_ACTION_COST = SUPPORT_RALLY_TOUR_TICK_ACTION_COST;
