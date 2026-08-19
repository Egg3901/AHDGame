import type { AuthUserWithCharacter } from "@/lib/auth";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { assertSameCountry, isSameCountry } from "@/lib/api/sameCountry";
import {
  isCampaignManagerUser,
  isCampaignNomineeUser,
  legacyManagersAsList,
  MAX_CAMPAIGN_MANAGERS,
} from "@/lib/campaigns/access";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { campaignAnchorToLocal, campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { createNotification } from "@/lib/notifications";
import type {
  Campaign,
  Character,
  Election,
  ElectionCandidate,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import {
  getEffectiveBranchCost,
  getOpsBranch,
  getCampaignFamilyScalar,
  type OpsBranchKey,
  type UpgradeCategory,
} from "@/lib/campaigns/upgradeCosts";
import {
  SUPPORT_RALLY_FULL_VALUE,
  SUPPORT_RALLY_ACTION_COST,
  SUPPORT_RALLY_TOUR_TICK_ACTION_COST,
} from "@/lib/electionEngine/electionFormulaFactors";
import { buildRallyAccrualEntry } from "@/lib/turn/elections/supportAccrual";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { ObjectId, type ClientSession, type Db, type UpdateFilter } from "mongodb";
import { getGameTime } from "@/lib/time/gameTime";
import { isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";
import {
  CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER,
  campaignStrengthContributionActions,
  campaignStrengthContributionCost,
} from "@/lib/campaigns/campaignStrength";

export async function upgradeCampaign(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character };
  category: UpgradeCategory;
  /** Branch sub-track to level; null buys the lever's tier-1 starter unlock. */
  branch?: OpsBranchKey | null;
  targetId?: string;
}) {
  const { db, campaignId, user, category, targetId } = params;
  const branch = params.branch ?? null;
  const campaign = await getCampaignOrThrow(db, campaignId);
  await assertCampaignManagerOrNominee(db, campaign, user);

  const election = await db.collection<Election>("elections").findOne({ _id: campaign.electionId });
  if (!user.isAdmin) {
    assertSameCountry(user.character, election, {
      message: "You cannot upgrade a campaign in another country",
    });
  }
  // General phase = a race that has a primary which has closed and whose
  // general hasn't ended. Turn-first (drift-immune) with a Date fallback.
  const gameTime = await getGameTime();
  const isGeneralPhase = isCampaignUpgradeGeneralPhase(election, gameTime.currentTurn, gameTime);

  // Current branch-tree state for this lever (may be undefined on legacy rows;
  // the migration backfills it, but tolerate absence defensively).
  const tree = (campaign[`${category}Tree` as keyof Campaign] as
    { starter: boolean; a: number; b: number; c: number } | undefined) ?? {
    starter: false,
    a: 0,
    b: 0,
    c: 0,
  };

  const isStarterPurchase = !tree.starter;
  if (isStarterPurchase && branch !== null) {
    throw badRequest("Unlock this lever's starter before buying a branch");
  }
  if (!isStarterPurchase && branch === null) {
    throw badRequest("Select a branch to upgrade");
  }

  const currentBranchLevel = branch === null ? 0 : tree[branch];
  const nextLevel = branch === null ? 0 : currentBranchLevel + 1;
  // SSOT cost helper — shares the per-race-family scalar and general-phase
  // surcharge with the UI preview so the enabled "Upgrade" button always passes
  // this gate. Returns null when the branch is already maxed.
  const cost = getEffectiveBranchCost(
    category,
    branch,
    nextLevel,
    election?.electionType,
    isGeneralPhase
  );
  if (!cost) {
    throw badRequest("Max level reached");
  }

  const adjustedFunds = cost.funds;
  const adjustedActions = cost.actions;
  // Campaign treasury is stored in the campaign's local currency; the cost
  // table is anchor. Convert at the frozen base rate (matches campaignTurn).
  const countryId = election?.countryId ?? "US";
  const adjustedFundsLocal = campaignAnchorToLocal(adjustedFunds, countryId);
  if (campaign.funds < adjustedFundsLocal) {
    throw badRequest("Insufficient funds");
  }
  if (campaign.actions < adjustedActions) {
    throw badRequest("Insufficient actions");
  }

  // Determine this branch's effect type for on-purchase (lump) effects.
  const branchDef = branch === null ? null : getOpsBranch(category, branch);
  const effectType = branchDef?.effectType;
  // Bundlers (incomeLumpOnPurchase) credit a one-time cash infusion, in local $.
  const lumpFundsLocal =
    effectType === "incomeLumpOnPurchase" && cost.lumpSum
      ? campaignAnchorToLocal(cost.lumpSum, countryId)
      : 0;

  // Opposition-research target resolution. Required when unlocking the oppo
  // starter (sets the target) and for a Scandal Leak (needs a current target).
  let targetName: string | null = null;
  let oppoTargetChar: Character | null = null;
  const needsTargetNow =
    category === "oppositionResearch" && (isStarterPurchase || effectType === "oppoLumpOnPurchase");
  const resolvedTargetId = targetId ?? campaign.oppositionTargetId?.toString();
  if (needsTargetNow) {
    if (!resolvedTargetId) {
      throw badRequest("Target required for opposition research");
    }
    const targetOid = new ObjectId(resolvedTargetId);
    if (targetOid.equals(campaign.candidateId)) {
      throw badRequest("You cannot research your own candidate");
    }
    const targetChar = await db.collection<Character>("characters").findOne({ _id: targetOid });
    oppoTargetChar = targetChar;
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
    targetName = target.name;
  }

  const turnNumber = await getCurrentTurn(db);
  const activity: Campaign["activityHistory"][0] = {
    type: "upgrade",
    category,
    ...(branch ? { branch } : {}),
    newLevel: branch === null ? 1 : nextLevel,
    costFunds: adjustedFundsLocal,
    costActions: adjustedActions,
    ...(targetName ? { targetName } : {}),
    timestamp: new Date(),
    turnNumber,
  };

  const setOnPurchase: Record<string, unknown> = { updatedAt: new Date() };
  const incOnPurchase: Record<string, number> = {
    funds: -adjustedFundsLocal + lumpFundsLocal,
    actions: -adjustedActions,
    totalFundsSpent: adjustedFundsLocal,
    // A2 — money driver reads per-turn spend, not lifetime balance.
    spendThisTurn: adjustedFundsLocal,
    totalActionsSpent: adjustedActions,
  };
  if (branch === null) {
    // Buying the starter initializes the tree with all branches at 0.
    setOnPurchase[`${category}Tree`] = { starter: true, a: 0, b: 0, c: 0 };
  } else {
    incOnPurchase[`${category}Tree.${branch}`] = 1;
  }
  if (category === "oppositionResearch" && resolvedTargetId && needsTargetNow) {
    setOnPurchase.oppositionTargetId = new ObjectId(resolvedTargetId);
    setOnPurchase.oppositionTargetName = targetName;
  }

  // Race-safe conditional update: guard on affordability AND the exact tree
  // state we costed against, so concurrent purchases can't double-apply.
  const guard: Record<string, unknown> = {
    _id: campaignId,
    funds: { $gte: adjustedFundsLocal },
    actions: { $gte: adjustedActions },
  };
  if (branch === null) {
    guard[`${category}Tree.starter`] = { $ne: true };
  } else {
    guard[`${category}Tree.starter`] = true;
    guard[`${category}Tree.${branch}`] = currentBranchLevel;
  }

  const updateResult = await db.collection<Campaign>("campaigns").updateOne(guard, {
    $inc: incOnPurchase,
    $push: { activityHistory: { $each: [activity], $slice: -10 } },
    $set: setOnPurchase,
  });
  if (updateResult.modifiedCount === 0) {
    throw new ApiError(
      409,
      "Campaign resources or upgrade level changed. Please refresh and try again."
    );
  }

  // Scandal Leak (oppoLumpOnPurchase): apply a one-time favorability hit to the
  // current target, clamped to [0,100]. `cost.lumpSum` is the % magnitude.
  if (effectType === "oppoLumpOnPurchase" && cost.lumpSum && resolvedTargetId) {
    const targetOid = new ObjectId(resolvedTargetId);
    const clampFav = [
      {
        $set: {
          favorability: {
            $min: [
              100,
              { $max: [0, { $add: [{ $ifNull: ["$favorability", 0] }, -cost.lumpSum] }] },
            ],
          },
        },
      },
    ];
    const charRes = await db.collection("characters").updateOne({ _id: targetOid }, clampFav);
    if (charRes.matchedCount === 0) {
      await db.collection("npps").updateOne({ _id: targetOid }, clampFav);
    }
  }

  // First-time (or changed) opposition-research target gets a notification.
  if (
    category === "oppositionResearch" &&
    oppoTargetChar &&
    String(campaign.oppositionTargetId ?? "") !== String(resolvedTargetId ?? "")
  ) {
    await notifyOppositionResearchTarget(db, oppoTargetChar, user.character.name);
  }

  const updated = await getCampaignOrThrow(db, campaignId);
  return {
    funds: updated.funds,
    actions: updated.actions,
    trees: {
      fundraising: updated.fundraisingTree ?? null,
      oppositionResearch: updated.oppositionResearchTree ?? null,
      groundGame: updated.groundGameTree ?? null,
      mediaSpending: updated.mediaSpendingTree ?? null,
    },
    oppositionTargetId: updated.oppositionTargetId?.toString() || null,
    oppositionTargetName: updated.oppositionTargetName,
  };
}

export async function donateToCampaign(params: {
  db: Db;
  campaignId: ObjectId;
  user: AuthUserWithCharacter & { hasCharacter: true; character: Character };
  amount: number;
  partyId?: string;
}) {
  const { db, campaignId, user, amount, partyId } = params;
  const campaign = await getCampaignOrThrow(db, campaignId);
  const forexEnabled = await isForexEnabled();
  const turnNumber = await getCurrentTurn(db);

  if (partyId) {
    const numericPartyId = Number(partyId);
    if (!Number.isFinite(numericPartyId)) {
      throw badRequest("Invalid party id");
    }

    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: numericPartyId, countryId: user.character.countryId });
    if (!party) {
      throw notFound("Party not found");
    }

    const ownedCharacters = await db
      .collection<Character>("characters")
      .find(
        { userId: new ObjectId(user.userId) },
        { projection: { _id: 1, name: 1, countryId: 1 } }
      )
      .toArray();
    const ownedCharacterIds = ownedCharacters.map((character) => character._id);
    const officerCharacter = party.chairId
      ? ownedCharacters.find((character) => character._id.equals(party.chairId!))
      : undefined;
    const viceChairCharacter = party.viceChairId
      ? ownedCharacters.find((character) => character._id.equals(party.viceChairId!))
      : undefined;
    const treasurerCharacter = party.treasurerId
      ? ownedCharacters.find((character) => character._id.equals(party.treasurerId!))
      : undefined;
    const officerMatch = officerCharacter
      ? { role: "chair" as const, character: officerCharacter }
      : viceChairCharacter
        ? { role: "viceChair" as const, character: viceChairCharacter }
        : treasurerCharacter
          ? { role: "treasurer" as const, character: treasurerCharacter }
          : null;
    if (!officerMatch || ownedCharacterIds.length === 0) {
      throw forbidden(
        "Only the party chair, vice chair, or treasurer may donate from the party treasury"
      );
    }

    const election = await db
      .collection<Election>("elections")
      .findOne({ _id: campaign.electionId }, { projection: { countryId: 1 } });
    if (!election) {
      throw notFound("Election not found");
    }
    if (String(party.sequentialId) !== campaign.party || !isSameCountry(party, election)) {
      throw forbidden("Cannot donate party treasury funds to a campaign outside this party");
    }
    // `amount` arrives in ANCHOR. The party treasury is LOCAL (party home
    // currency) and the campaign treasury is now LOCAL (campaign country
    // currency); party and campaign share a country, so `amountPartyLocal` is
    // the correct unit for BOTH the treasury debit and the campaign credit.
    // Campaign funds are decoupled from live forex — convert at the frozen base
    // INITIAL_RATES scale (the same scale campaign taxes fill the party treasury
    // at). Party and campaign share a country, so this local amount is correct
    // for BOTH the treasury debit and the campaign credit.
    const amountPartyLocal = forexEnabled
      ? campaignAnchorToLocal(amount, party.countryId ?? "US")
      : amount;

    if ((party.treasury ?? 0) < amountPartyLocal) {
      throw badRequest("Insufficient party funds");
    }

    const officerRole = officerMatch.role;
    const roleLabel =
      officerRole === "chair" ? "Chair" : officerRole === "viceChair" ? "Vice Chair" : "Treasurer";
    const donorName = `${party.name ?? "Party"} (${roleLabel})`;
    const donationEntry: Campaign["donationLog"][0] = {
      donorId: party._id.toString(),
      donorName,
      donorType: "party",
      amount: amountPartyLocal,
      timestamp: new Date(),
      turnNumber,
    };
    const now = new Date();
    const campaignUpdate: UpdateFilter<Campaign> = {
      $inc: { funds: amountPartyLocal, totalFundsGenerated: amountPartyLocal },
      $push: {
        donationLog: {
          $each: [donationEntry],
          $slice: -100,
        },
      },
      $set: { updatedAt: now },
    };
    const partyDebit: UpdateFilter<PoliticalParty> = {
      $inc: { treasury: -amountPartyLocal },
      $set: { updatedAt: now },
    };

    const applyPartyDonationInTransaction = async (session: ClientSession) => {
      const debitResult = await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id, treasury: { $gte: amountPartyLocal } }, partyDebit, {
          session,
        });
      if (debitResult.matchedCount === 0) {
        throw badRequest("Insufficient party funds");
      }
      const campaignUpdateResult = await db
        .collection<Campaign>("campaigns")
        .updateOne({ _id: campaignId }, campaignUpdate, { session });
      if (campaignUpdateResult.matchedCount === 0) {
        throw notFound("Campaign not found");
      }
    };

    const applyPartyDonationWithoutTransaction = async () => {
      const debitResult = await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id, treasury: { $gte: amountPartyLocal } }, partyDebit);
      if (debitResult.matchedCount === 0) {
        throw badRequest("Insufficient party funds");
      }

      const campaignUpdateResult = await db
        .collection<Campaign>("campaigns")
        .updateOne({ _id: campaignId }, campaignUpdate);
      if (campaignUpdateResult.matchedCount === 0) {
        await db
          .collection<PoliticalParty>("politicalParties")
          .updateOne(
            { _id: party._id },
            { $inc: { treasury: amountPartyLocal }, $set: { updatedAt: new Date() } }
          );
        throw notFound("Campaign not found");
      }
    };

    await runWithOptionalTransaction(
      async (session) => {
        await applyPartyDonationInTransaction(session);
      },
      async () => {
        await applyPartyDonationWithoutTransaction();
      }
    );

    // Log the donor-side outflow in the party's local home currency — same
    // unit the treasury ledger / chair UI displays. (The donation amount the
    // player typed is in anchor; we record the LOCAL value actually debited.)
    void db.collection("activityLog").insertOne({
      type: "fund_event",
      timestamp: now,
      userId: new ObjectId(user.userId),
      characterId: officerMatch.character._id,
      characterName: officerMatch.character.name,
      username: user.username,
      countryId: party.countryId,
      fundEventType: "campaign_donation",
      donorRole: officerRole,
      amount: amountPartyLocal,
      currencyCode: COUNTRY_CURRENCY_MAP[party.countryId] ?? "USD",
      fromId: party._id,
      fromName: donorName,
      fromType: "party",
      toId: campaignId,
      toName: campaignId.toString(),
      toType: "campaign",
    });

    await emitTreasuryTransaction({
      db,
      countryId: party.countryId,
      partyId: String(party.sequentialId),
      holderType: "party",
      holderId: String(party.sequentialId),
      category: "campaign_donation",
      direction: "debit",
      amount: amountPartyLocal,
      memo: `Campaign donation (${officerRole})`,
      counterparty: { type: "campaign", id: campaignId.toString() },
      now,
    });

    return;
  }

  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: user.character._id });
  if (!character) {
    throw notFound("Character not found");
  }

  const characterDonationElection = await db
    .collection<Election>("elections")
    .findOne({ _id: campaign.electionId }, { projection: { countryId: 1 } });
  if (!characterDonationElection) {
    throw notFound("Election not found");
  }
  assertSameCountry(character, characterDonationElection, {
    message: "You cannot donate to campaigns in other countries",
  });

  // `amount` is the user-requested donation in ANCHOR (₳) units (the UI error
  // messages say ₳ — see line 463 below). Campaign funds are decoupled from live
  // forex — convert at the frozen base INITIAL_RATES scale.
  const amountLocal = forexEnabled
    ? campaignAnchorToLocal(amount, character.countryId ?? "US")
    : amount;
  const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
  if ((character.currencyBalances?.campaign ?? character.funds ?? 0) < amountLocal) {
    throw badRequest("Insufficient funds");
  }

  const donationEntry: Campaign["donationLog"][0] = {
    donorId: character._id.toString(),
    donorName: character.name,
    donorType: "character",
    amount: amountLocal,
    timestamp: new Date(),
    turnNumber,
  };
  const now = new Date();
  // Campaign treasury is stored in the campaign's local currency. The donor and
  // election are same-country (asserted above), so `amountLocal` — the local
  // value debited from the donor — is already in the campaign's currency.
  const campaignUpdate: UpdateFilter<Campaign> = {
    $inc: { funds: amountLocal, totalFundsGenerated: amountLocal },
    $push: {
      donationLog: {
        $each: [donationEntry],
        $slice: -100,
      },
    },
    $set: { updatedAt: now },
  };
  const characterDebit = { $inc: { [campaignFundsField]: -amountLocal } };
  const characterBalanceFilter: Record<string, unknown> = {
    _id: character._id,
    [campaignFundsField]: { $gte: amountLocal },
  };

  await runWithOptionalTransaction(
    async (session) => {
      const debitResult = await db
        .collection<Character>("characters")
        .updateOne(characterBalanceFilter, characterDebit, { session });
      if (debitResult.matchedCount === 0) {
        throw badRequest("Insufficient funds");
      }

      const campaignUpdateResult = await db
        .collection<Campaign>("campaigns")
        .updateOne({ _id: campaignId }, campaignUpdate, { session });
      if (campaignUpdateResult.matchedCount === 0) {
        throw notFound("Campaign not found");
      }
    },
    async () => {
      const debitResult = await db
        .collection<Character>("characters")
        .updateOne(characterBalanceFilter, characterDebit);
      if (debitResult.matchedCount === 0) {
        throw badRequest("Insufficient funds");
      }

      try {
        const campaignUpdateResult = await db
          .collection<Campaign>("campaigns")
          .updateOne({ _id: campaignId }, campaignUpdate);
        if (campaignUpdateResult.matchedCount === 0) {
          throw notFound("Campaign not found");
        }
      } catch (error) {
        await db
          .collection<Character>("characters")
          .updateOne({ _id: character._id }, { $inc: { [campaignFundsField]: amountLocal } });
        throw error;
      }
    }
  );

  // Log the donor-side outflow in the character's local home currency so the
  // activityLog reflects what the character actually paid. The Campaign.funds
  // ledger remains anchor-denominated until that subsystem is migrated.
  void db.collection("activityLog").insertOne({
    type: "fund_event",
    timestamp: now,
    userId: new ObjectId(user.userId),
    characterId: character._id,
    characterName: character.name,
    username: user.username,
    countryId: character.countryId,
    fundEventType: "campaign_donation",
    amount: amountLocal,
    currencyCode: COUNTRY_CURRENCY_MAP[character.countryId] ?? "USD",
    fromId: character._id,
    fromName: character.name,
    fromType: "character",
    toId: campaignId,
    toName: campaignId.toString(),
    toType: "campaign",
  });
}

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
}) {
  const { db, campaignId, user } = params;
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
  const strengthAdded = npi * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER;
  if (strengthAdded <= 0) {
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
  const homeCurrency = getHomeCurrency(character);
  // Campaign funds are decoupled from live forex — the strength cost converts at
  // the frozen base INITIAL_RATES scale.
  const campaignRate = forexEnabled ? campaignLocalRate(character.countryId ?? "US") : 1;

  const currentCS = campaign.campaignStrength ?? 0;
  const costFunds = campaignStrengthContributionCost(currentCS, strengthAdded);
  const costFundsLocal = forexEnabled ? costFunds * campaignRate : costFunds;
  const costActions = campaignStrengthContributionActions(strengthAdded);
  if (character.actions < costActions) {
    throw badRequest(`Insufficient actions. Need ${costActions}, have ${character.actions}`);
  }
  const availableLocal = character.currencyBalances?.campaign ?? character.funds ?? 0;
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
      message: `Added ${strengthAdded.toFixed(1)} campaign strength to ${targetName}`,
    },
    summary: `campaign_strength - ${actorName} added ${strengthAdded.toFixed(1)} CS to ${targetName}`,
    details: {
      campaignId: campaignId.toString(),
      electionId: campaign.electionId.toString(),
      electionType: election.electionType,
      countryId: election.countryId,
      candidateId: targetCandidateId,
      candidateName: targetName,
      candidateParty: targetCandidate?.party ?? campaign.party,
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
async function notifyOppositionResearchTarget(
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
          $slice: -10,
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

async function getCampaignOrThrow(db: Db, campaignId: ObjectId): Promise<Campaign> {
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

async function assertCampaignManagerOrNominee(
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

async function getCurrentTurn(db: Db): Promise<number> {
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
  await assertCampaignManagerOrNominee(db, campaign, user);

  const now = new Date();
  const election = await db.collection<Election>("elections").findOne({ _id: campaign.electionId });
  if (!election) {
    throw notFound("Election not found");
  }
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
