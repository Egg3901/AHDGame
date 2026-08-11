import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { PoliticalParty, ExchangeRate } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import type { Corporation } from "@/lib/db/types/corporation";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { IndexFund } from "@/lib/db/types/indexFund";
import type { RetiredCharacter, RetiredCharacterSnapshot } from "@/lib/db/types/retiredCharacter";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  getCorpFxRate,
  shareTradeAnchorValue,
  corpCapitalToAnchor,
} from "@/lib/currency/corporationCapital";
import {
  cleanupShareMarketActivityForCharacters,
  cleanupShareMarketActivityForCorporations,
} from "@/lib/corporations/cleanupShareMarketActivity";
import { releaseCharacterHeldSharesToFloat } from "@/lib/corporations/releaseCharacterHeldSharesToFloat";
import { releaseCharacterHeldBondsToFloat } from "@/lib/corporations/releaseCharacterHeldBondsToFloat";
import { releaseCharacterHeldIndexFundPositionsToFloat } from "@/lib/indexFunds/releaseCharacterHeldPositionsToFloat";
import { listCharacterPositions } from "@/lib/indexFunds/fundQueries";
import { closeCeoTenure } from "@/lib/corporations/ceoHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { releaseCorporationHeldSharesToFloat } from "@/lib/corporations/releaseHeldSharesToFloat";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { deriveHighestOffice } from "@/lib/character/deriveHighestOffice";
import type { GameIteration } from "@/lib/db/types/gameState";
import type { CharacterRecap } from "@/lib/recap/types";

/**
 * Core retirement function: snapshots a character, cleans up all gameplay
 * references across collections, deletes the character document, and updates
 * the owning user record.
 *
 * `opts.iteration`/`opts.recap` carry the Season Recap ("Wrapped") payload the
 * caller built BEFORE this runs (this function deletes actionLogs, so the recap
 * cannot be built here). They are stamped onto the RetiredCharacter doc;
 * `recapViewedAt` is intentionally left unset so the post-reset gate surfaces it.
 */
export async function retireCharacter(
  db: Db,
  character: Character,
  userId: ObjectId,
  reason: RetiredCharacter["reason"],
  opts?: { iteration?: GameIteration; recap?: CharacterRecap }
): Promise<void> {
  const characterId = character._id;
  const now = new Date();

  const achievementCount = await db
    .collection("characterAchievements")
    .countDocuments({ characterId });

  const highestOffice = deriveHighestOffice(character);

  // Value held shares/bonds/index-fund positions BEFORE the release calls
  // further down zero them out — this is the only chance to record what they
  // were worth, so the Hall of Fame's net-worth ranking doesn't lose them.
  const [heldCorps, heldBonds, heldFundPositions] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find(
        { "shareholders.characterId": characterId },
        { projection: { _id: 1, shareholders: 1, sharePrice: 1, liquidCurrencyCode: 1 } }
      )
      .toArray(),
    db
      .collection<Bond>("bonds")
      .find(
        { "holders.characterId": characterId },
        { projection: { _id: 1, holders: 1, marketPrice: 1, currencyCode: 1 } }
      )
      .toArray(),
    listCharacterPositions(db, characterId),
  ]);

  let shareValueAnchor = 0;
  for (const corp of heldCorps) {
    const shares =
      corp.shareholders?.find((s) => s.characterId?.toString() === characterId.toString())
        ?.shares ?? 0;
    if (shares <= 0) continue;
    const fxRate = await getCorpFxRate(db, corp);
    shareValueAnchor += shareTradeAnchorValue(shares, corp, fxRate);
  }

  let bondValueAnchor = 0;
  for (const bond of heldBonds) {
    const units =
      bond.holders?.find((h) => h.characterId?.toString() === characterId.toString())?.units ?? 0;
    if (units <= 0) continue;
    const localValue = units * BOND_UNIT_FACE_VALUE * (bond.marketPrice ?? 1);
    const fxRate = bond.currencyCode
      ? ((
          await db
            .collection<ExchangeRate>("exchangeRates")
            .findOne({ currencyCode: bond.currencyCode })
        )?.rate ?? 1)
      : 1;
    bondValueAnchor += corpCapitalToAnchor(localValue, bond.currencyCode, fxRate);
  }

  // Index-fund NAV is already anchor-denominated — no FX conversion needed.
  let indexFundValueAnchor = 0;
  if (heldFundPositions.length > 0) {
    const fundIds = heldFundPositions.map((p) => p.fundId);
    const funds = await db
      .collection<IndexFund>("indexFunds")
      .find({ _id: { $in: fundIds } }, { projection: { _id: 1, quotedNav: 1 } })
      .toArray();
    const navByFund = new Map(funds.map((f) => [f._id.toString(), f.quotedNav]));
    for (const pos of heldFundPositions) {
      indexFundValueAnchor += (pos.units ?? 0) * (navByFund.get(pos.fundId.toString()) ?? 0);
    }
  }

  let partyName = "Independent";
  if (character.party !== "independent") {
    const partyDoc = await db.collection("politicalParties").findOne({
      sequentialId: Number(character.party),
      countryId: character.countryId,
    });
    if (partyDoc) partyName = partyDoc.name;
  }

  const snapshot: RetiredCharacterSnapshot = {
    name: character.name,
    countryId: character.countryId,
    homeState: character.homeState,
    party: character.party,
    partyName,
    currentOffice: character.currentOffice,
    policies: character.policies,
    demographics: character.demographics,
    stats: {
      politicalInfluence: character.politicalInfluence,
      nationalInfluence: character.nationalInfluence,
      partyInfluence: character.partyInfluence,
      favorability: character.favorability,
      infamy: character.infamy,
      // LOCAL home-currency balances at time of retirement.
      funds: character.currencyBalances?.campaign ?? character.funds ?? 0,
      cashOnHand:
        character.currencyBalances?.personal?.[getHomeCurrency(character)] ??
        character.cashOnHand ??
        0,
      savingsOnHand:
        character.currencyBalances?.savings?.[getHomeCurrency(character)] ??
        character.savingsOnHand ??
        0,
      shareValueAnchor,
      bondValueAnchor,
      indexFundValueAnchor,
    },
    avatarUrl: character.avatarUrl,
    profileHeaderImageUrl: character.profileHeaderImageUrl,
    bio: character.bio,
    careerHistory: character.careerHistory,
    highestOffice,
    achievementCount,
    createdAt: character.createdAt,
  };

  const retiredDoc: Omit<RetiredCharacter, "_id"> = {
    userId,
    characterId,
    retiredAt: now,
    reason,
    snapshot,
    ...(opts?.iteration ? { iteration: opts.iteration } : {}),
    ...(opts?.recap ? { recap: opts.recap } : {}),
  };
  await db.collection("retiredCharacters").insertOne(retiredDoc);

  const activeElections = await db
    .collection("elections")
    .find({ status: { $nin: ["completed", "resolved"] } })
    .project({ _id: 1 })
    .toArray();
  const activeElectionIds = activeElections.map((election) => election._id);

  if (activeElectionIds.length > 0) {
    await db.collection("electionCandidates").deleteMany({
      characterId,
      electionId: { $in: activeElectionIds },
    });
  }

  await db.collection("electedOfficials").updateMany(
    { characterId },
    {
      $set: { characterId: null, updatedAt: now },
      $unset: { characterName: "", party: "", electedAt: "" },
    }
  );

  const forexEnabled = await isForexEnabled();
  const ceoCorps = await db
    .collection<Corporation>("corporations")
    .find({ ceoId: characterId }, { projection: { _id: 1 } })
    .toArray();
  const ceoCorpIds = ceoCorps.map((corp) => corp._id);

  // Exit paths must unwind pending market state before the character row
  // disappears, otherwise escrow and reserved shares can be stranded.
  await cleanupShareMarketActivityForCharacters(db, [characterId], now, forexEnabled);
  await cleanupShareMarketActivityForCorporations(db, ceoCorpIds, now, forexEnabled);

  await releaseCharacterHeldSharesToFloat(db, [characterId], now);
  // Bonds and index-fund positions were never released on character exit
  // before this — orphaned characterId references piling up on issuer/fund
  // books (coupons/NAV still accruing against a holder that no longer
  // exists). Mirrors the share release immediately above.
  await releaseCharacterHeldBondsToFloat(db, [characterId], now);
  await releaseCharacterHeldIndexFundPositionsToFloat(db, [characterId]);
  for (const ceoCorpId of ceoCorpIds) {
    await releaseCorporationHeldSharesToFloat(db, ceoCorpId, now);
  }

  await db
    .collection<Corporation>("corporations")
    .updateMany(
      { ceoId: characterId },
      { $set: { ceoId: null as unknown as ObjectId, ceoVacant: true, updatedAt: now } }
    );

  if (ceoCorpIds.length > 0) {
    const retireTurn = await getCurrentTurn(db);
    for (const ceoCorpId of ceoCorpIds) {
      await closeCeoTenure(db, ceoCorpId, { holderId: characterId, turn: retireTurn });
    }
  }

  await db
    .collection("coalitions")
    .updateMany(
      { chairCharacterId: characterId },
      { $set: { chairCharacterId: null, updatedAt: now } }
    );

  if (character.party !== "independent") {
    await db
      .collection("politicalParties")
      .updateOne(
        { sequentialId: Number(character.party), countryId: character.countryId },
        { $inc: { memberCount: -1 } }
      );
  }

  if (character.party !== "independent") {
    const partyQuery = {
      sequentialId: Number(character.party),
      countryId: character.countryId,
    };
    const partyDoc = await db.collection<PoliticalParty>("politicalParties").findOne(partyQuery);
    if (partyDoc) {
      const partySet: Record<string, unknown> = {};
      if (partyDoc.chairId?.toString() === characterId.toString()) partySet.chairId = null;
      if (partyDoc.viceChairId?.toString() === characterId.toString()) partySet.viceChairId = null;
      if (partyDoc.treasurerId?.toString() === characterId.toString()) partySet.treasurerId = null;
      const isCommitteeMember = partyDoc.committeeIds?.some(
        (id) => id.toString() === characterId.toString()
      );
      const isCampaigner = (partyDoc.campaignerIds ?? []).some(
        (id) => id.toString() === characterId.toString()
      );
      const updateOp: Record<string, unknown> = {};
      if (Object.keys(partySet).length > 0) {
        updateOp.$set = { ...partySet, updatedAt: now };
      }
      const pullUpdates: Record<string, unknown> = {};
      if (isCommitteeMember) pullUpdates.committeeIds = characterId;
      if (isCampaigner) pullUpdates.campaignerIds = characterId;
      if (Object.keys(pullUpdates).length > 0) {
        updateOp.$pull = pullUpdates;
        if (!updateOp.$set) updateOp.$set = { updatedAt: now };
      }
      if (Object.keys(updateOp).length > 0) {
        await db
          .collection<PoliticalParty>("politicalParties")
          .updateOne({ _id: partyDoc._id }, updateOp);
      }

      if (partySet.chairId === null) {
        await db
          .collection("coalitions")
          .updateMany(
            { chairPartyId: partyDoc._id },
            { $set: { chairCharacterId: null, updatedAt: now } }
          );
      }
    }
  }

  // Clear state-party leadership/campaigner assignments tied to this character.
  // We sweep across all parties (no `partyId` filter) because a character can
  // hold a state-level seat in any state's row of any party they belong to —
  // and once they retire, none of those assignments are valid. Unlike the
  // national party leadership cleared above, these were previously never
  // cleared (ticket #0860): a retired state chair/vice-chair/treasurer left a
  // stale id behind, so the leadership route's vacancy check kept rejecting
  // new appointments with "not vacant" even though the seat's holder no
  // longer exists.
  await db
    .collection("statePartyOrg")
    .updateMany({ campaignerId: characterId }, { $set: { campaignerId: null, updatedAt: now } });
  await db
    .collection("statePartyOrg")
    .updateMany({ chairId: characterId }, { $set: { chairId: null, updatedAt: now } });
  await db
    .collection("statePartyOrg")
    .updateMany({ viceChairId: characterId }, { $set: { viceChairId: null, updatedAt: now } });
  await db
    .collection("statePartyOrg")
    .updateMany({ treasurerId: characterId }, { $set: { treasurerId: null, updatedAt: now } });

  await db
    .collection("nationalCommitteeCandidates")
    .updateMany(
      { characterId, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  await db.collection("nationalCommitteeVotes").deleteMany({ voterId: characterId });

  await db.collection("congressLeaders").deleteMany({ characterId });
  await db.collection("statePartyCandidates").deleteMany({ characterId });
  await db.collection("statePartyVotes").deleteMany({ voterId: characterId });
  await db.collection("nationalPartyCandidates").deleteMany({ characterId });
  await db.collection("nationalPartyVotes").deleteMany({ voterId: characterId });

  // Phase 6 charter cleanup — if this character is a founder on any
  // in-flight charter, auto-reject their signature and transition the
  // charter to `founder-replacement` so surviving founders can nominate
  // a replacement. Without this, character deletion leaves a ghost
  // ObjectId on the charter that renders as a raw hex string in the UI.
  //
  // Only touches non-terminal charters (draft / pending-signatures /
  // founder-replacement). Ratified / expired / rejected charters are
  // historical records and should not be modified.
  const activeCharterStatuses = ["draft", "pending-signatures", "founder-replacement"];
  const affectedCharters = await db
    .collection("partyCharters")
    .find({
      foundersCharacterIds: characterId,
      status: { $in: activeCharterStatuses },
    })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  if (affectedCharters.length > 0) {
    const { computeCharterDeadline, computeCharterDeadlineTurn } =
      await import("@/lib/charters/charterDeadlines");
    const replacementDeadline = computeCharterDeadline(now);
    const charterTurn = await getCurrentTurn(db);
    const replacementDeadlineTurn = computeCharterDeadlineTurn(charterTurn);
    for (const charter of affectedCharters) {
      await db.collection("partyCharters").updateOne(
        {
          _id: charter._id,
          "signatures.characterId": characterId,
          // Only touch unsigned or already-signed slots — don't
          // overwrite an existing rejection (e.g. from a ban cascade).
          "signatures.rejectedAt": { $exists: false },
        },
        {
          $set: {
            "signatures.$.rejectedAt": now,
            "signatures.$.rejectionReason": "Founder character deleted",
            status: "founder-replacement",
            founderReplacementDeadline: replacementDeadline,
            founderReplacementDeadlineTurn: replacementDeadlineTurn,
            updatedAt: now,
          },
        }
      );
    }
  }

  // Remove all endorsements where the retired character is the endorser. Also
  // remove endorsements of any candidate row that belongs to the retired
  // character (playerEndorsements.candidateId is the electionCandidates _id).
  const ownCandidates = await db
    .collection<{ _id: ObjectId }>("electionCandidates")
    .find({ characterId }, { projection: { _id: 1 } })
    .toArray();
  const ownCandidateIds = ownCandidates.map((c) => c._id);
  await db.collection("playerEndorsements").deleteMany({
    $or: [{ characterId }, { candidateId: { $in: ownCandidateIds } }],
  });

  await db.collection("actionLogs").deleteMany({ characterId });

  // Stamp the financial ledger BEFORE deleting the character doc. Pre-Phase-4
  // retirement orphaned the tx history (subjectId pointed at a row that no
  // longer existed), making admin forensic queries fall back to subjectName
  // string-matching. Phase 4 records the deletion timestamp + sequentialId
  // on every tx row referencing this character (subject + counterparty side
  // separately) and extends expiresAt to the full 168-turn window from now.
  await stampSubjectDeleted(db, characterId, {
    sequentialId: character.sequentialId,
    deletedAt: now,
  });

  await db.collection<Character>("characters").deleteOne({ _id: characterId });

  await db.collection("users").updateOne(
    { _id: userId },
    {
      $set: {
        hasCompletedSetup: false,
        activeCharacterId: null,
        ...(reason === "player_deleted" ? { lastRetiredAt: new Date() } : {}),
      },
      $inc: { activeCharacterCount: -1 },
    }
  );
}
