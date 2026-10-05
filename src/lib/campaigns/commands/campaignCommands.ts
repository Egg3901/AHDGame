import {
  loadCampaignCurrencyRates,
  loadCampaignPriceLevel,
  campaignAnchorToLocal,
} from "@/lib/campaigns/campaignCurrency";
import { loadOppositionTargets } from "@/lib/campaigns/oppositionTargets";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { assertSameCountry, isSameCountry } from "@/lib/api/sameCountry";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Campaign, Character, Election, NPP, PoliticalParty } from "@/lib/db/types";
import {
  getEffectiveBranchCost,
  getOpsBranch,
  type OpsBranchKey,
  type UpgradeCategory,
} from "@/lib/campaigns/upgradeCosts";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { getSeedCurrencyCode } from "@/lib/constants/currencies";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { ObjectId, type ClientSession, type Db, type UpdateFilter } from "mongodb";
import { getGameTime } from "@/lib/time/gameTime";
import { isCampaignUpgradeGeneralPhase } from "@/lib/elections/phases";
import { emitOpsLevelWire } from "@/lib/elections/raceWireEmit";
import { CAMPAIGN_ACTIVITY_HISTORY_CAP } from "@/lib/campaigns/constants/activityHistory";
import {
  notifyOppositionResearchTarget,
  getCampaignOrThrow,
  assertCampaignManagerOrNominee,
  assertCampaignActorForSurrogate,
  getCurrentTurn,
} from "./campaignManagementCommands";
export {
  appointCampaignManager,
  contributeCampaignStrength,
  retargetOppositionResearch,
  resetOppositionResearch,
  setCampaignColor,
  fireRallyOneShot,
  setRallyTourActive,
  RALLY_TOUR_TICK_ACTION_COST,
} from "./campaignManagementCommands";

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
  const campaignRates = await loadCampaignCurrencyRates(db);
  // Frozen-basis era: euro members price in EUR. One route-path read; the turn
  // phases that price the same costs already carry the preset in memory.
  const upgradePreset = await getGameStatePresetOrDefault(db);
  const priceLevel = await loadCampaignPriceLevel(db);
  const branch = params.branch ?? null;
  const campaign = await getCampaignOrThrow(db, campaignId);

  const election = await db.collection<Election>("elections").findOne({ _id: campaign.electionId });
  // Fundraising is the running-mate surrogate's only upgrade lane; every other
  // lever stays manager/nominee-only. The surrogate assert is a superset, so
  // managers/nominees are unaffected on the fundraising lane too.
  if (category === "fundraising") {
    await assertCampaignActorForSurrogate(db, campaign, election, user);
  } else {
    await assertCampaignManagerOrNominee(db, campaign, user);
  }

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

  const adjustedFunds = cost.funds * priceLevel;
  const adjustedActions = cost.actions;
  // Campaign treasury is stored in the campaign's local currency; the cost
  // table is anchor. Convert at the frozen base rate (matches campaignTurn).
  const countryId = election?.countryId ?? "US";
  const adjustedFundsLocal = campaignAnchorToLocal(
    adjustedFunds,
    countryId,
    campaignRates,
    upgradePreset
  );
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
      ? campaignAnchorToLocal(cost.lumpSum * priceLevel, countryId, campaignRates, upgradePreset)
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
    // The starter purchase is the OTHER way a target gets set, so it answers to
    // the same rule as /retarget. Guarding only the change would leave the one
    // path that sets the first target open to anybody in the country.
    if (election) {
      const eligible = await loadOppositionTargets(
        db,
        election,
        campaign.candidateId,
        await getGameTime()
      );
      if (!eligible.some((t) => t.id === targetOid.toString())) {
        throw badRequest("You can only research a candidate standing against you in this race");
      }
    }
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
    // Money driver reads decaying recent spend (spendStock + this turn's
    // accumulator), not lifetime balance and not the treasury. This turn's
    // spend accrues here; the reset sweep folds it into the stock after
    // voteAccumulation, so it must NOT $inc spendStock directly here.
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
    $push: {
      activityHistory: { $each: [activity], $slice: -CAMPAIGN_ACTIVITY_HISTORY_CAP },
    },
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

  // Per-race wire. Fire-and-forget: the emitter never throws, so a wire failure
  // cannot undo the purchase that was just committed.
  void emitOpsLevelWire(db, updated, category);

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
  const campaignRates = await loadCampaignCurrencyRates(db);
  // One route-path read: without the preset a 2027 euro donation prices at the
  // legacy rate while the war chest it debits is EUR-denominated.
  const donatePreset = await getGameStatePresetOrDefault(db);
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
    // world base-rate scale (the same scale campaign taxes fill the party treasury
    // at). Party and campaign share a country, so this local amount is correct
    // for BOTH the treasury debit and the campaign credit.
    const amountPartyLocal = forexEnabled
      ? campaignAnchorToLocal(amount, party.countryId ?? "US", campaignRates, donatePreset)
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
      currencyCode: getSeedCurrencyCode(party.countryId, donatePreset),
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
      currencyCode: getSeedCurrencyCode(party.countryId, donatePreset),
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
  // forex ; convert at the frozen world-seeded currency basis.
  const amountLocal = forexEnabled
    ? campaignAnchorToLocal(amount, character.countryId ?? "US", campaignRates, donatePreset)
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
    currencyCode: getSeedCurrencyCode(character.countryId, donatePreset),
    fromId: character._id,
    fromName: character.name,
    fromType: "character",
    toId: campaignId,
    toName: campaignId.toString(),
    toType: "campaign",
  });
}
