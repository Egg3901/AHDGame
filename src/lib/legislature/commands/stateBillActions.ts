import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import {
  getCountryConfig,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import { applyBillVotePolicyShift } from "@/lib/policyShift";
import { buildEmbeddedVoteTallyUpdate } from "@/lib/votes/embeddedVoteTally";
import type {
  Character,
  ElectedOfficial,
  GameState,
  PoliticalParty,
  StateBill,
} from "@/lib/db/types";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { createNotification } from "@/lib/notifications";
import { finalizeStateBillEnactment } from "@/lib/turn/billLifecycle/regionalEngine";
import { generateBillSignedNews, generateBillVetoedNews } from "@/lib/news";
import { isVotingDeadlinePassed } from "@/lib/legislature/billVotingWindow";
import type { LegislatureCommandResult } from "@/lib/legislature/commands/types";

const OVERRIDE_VOTING_HOURS = 24;

function validateStateBillId(billId: string): LegislatureCommandResult | null {
  if (!ObjectId.isValid(billId)) {
    return { status: 400, body: { error: "Invalid bill id" } };
  }
  return null;
}

export async function castStateBillVote(
  db: Db,
  countryId: CountryId,
  stateId: string,
  billId: string,
  user: AuthUserWithCharacter,
  vote: "for" | "against" | "abstain"
): Promise<LegislatureCommandResult> {
  // `electedOfficials.state` and `stateBills.stateId` are stored uppercase
  // (e.g. "AZ"); callers may pass either case depending on URL formatting.
  // Normalize here so the same command works regardless.
  stateId = stateId.toUpperCase();
  const now = new Date();
  const character = user.character;
  if (!character) {
    return { status: 400, body: { error: "No character found" } };
  }
  const invalidBillId = validateStateBillId(billId);
  if (invalidBillId) return invalidBillId;

  const countryConfig = getCountryConfig(countryId);
  const subNationalOffice = getSubNationalLegislatureKey(countryId);
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: subNationalOffice,
    state: stateId,
    characterId: character._id,
    countryId,
  });
  if (!official) {
    return {
      status: 403,
      body: {
        error: `You must hold ${countryConfig.subNationalChamber?.name ?? "State Senate"} seats in this region to vote`,
      },
    };
  }

  // One-party-state guard: banned parties cannot vote on state bills.
  // Reads runtime governmentType so a post-Stage-4 country's banned-party
  // restrictions lift immediately on conversion.
  const runtimeState = await getCountryState(db, countryId);
  if (runtimeState.governmentType === "onePartyState" && character.party) {
    const voterParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parseInt(character.party, 10), countryId });
    if (isBannedParty(countryConfig, voterParty)) {
      return {
        status: 403,
        body: { error: "Banned parties cannot vote on legislation." },
      };
    }
  }

  const seatsHeld = official.seatsHeld ?? 1;
  const bill = await db.collection<StateBill>("stateBills").findOne({
    _id: new ObjectId(billId),
    stateId,
  });
  if (!bill) {
    return { status: 404, body: { error: "Bill not found" } };
  }

  if (bill.status !== "active") {
    return { status: 400, body: { error: "Voting is not open for this bill" } };
  }

  const voteAcceptGameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" });
  const voteAcceptTurn = voteAcceptGameState?.currentTurn ?? 0;
  if (isVotingDeadlinePassed(bill.votingEndsAt, now, bill.votingEndsOnTurn, voteAcceptTurn)) {
    return { status: 400, body: { error: "Voting has ended" } };
  }

  const charId = character._id.toString();
  const updateResult = await db.collection<StateBill>("stateBills").updateOne(
    { _id: bill._id, status: "active" },
    buildEmbeddedVoteTallyUpdate({
      voteField: "votes",
      voteKey: charId,
      vote,
      tallyFieldByVote: {
        for: "votesFor",
        against: "votesAgainst",
        abstain: "votesAbstain",
      },
      updatedAt: now,
      weight: seatsHeld,
    })
  );
  if (updateResult.matchedCount === 0) {
    return {
      status: 409,
      body: { error: "This bill changed before your vote could be recorded" },
    };
  }

  const previousVote = bill.votes?.[charId];
  if (!previousVote || previousVote === "abstain") {
    try {
      await applyBillVotePolicyShift(
        db,
        character._id,
        (bill.provisions ?? []).filter(
          (provision) => provision.type !== "subsidy" && provision.type !== "end_subsidy"
        ),
        vote,
        character.policies
      );
    } catch (error) {
      console.warn("[policyShift] Failed to apply policy shift from state vote:", error);
    }
  }

  return { status: 200, body: { success: true, vote, seatsHeld } };
}

export async function castStateBillOverrideVote(
  db: Db,
  countryId: CountryId,
  stateId: string,
  billId: string,
  user: AuthUserWithCharacter,
  vote: "for" | "against"
): Promise<LegislatureCommandResult> {
  stateId = stateId.toUpperCase();
  const character = user.character;
  if (!character) {
    return { status: 400, body: { error: "No character found" } };
  }
  const invalidBillId = validateStateBillId(billId);
  if (invalidBillId) return invalidBillId;

  const subNationalOffice = getSubNationalLegislatureKey(countryId);
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: subNationalOffice,
    state: stateId,
    characterId: character._id,
    countryId,
  });
  if (!official) {
    return {
      status: 403,
      body: {
        error: `You must hold ${getCountryConfig(countryId).subNationalChamber?.name ?? "State Senate"} seats in this region to vote`,
      },
    };
  }

  const seatsHeld = official.seatsHeld ?? 1;
  const bill = await db.collection<StateBill>("stateBills").findOne({
    _id: new ObjectId(billId),
    stateId,
  });
  if (!bill) {
    return { status: 404, body: { error: "Bill not found" } };
  }

  const now = new Date();
  if (bill.status !== "veto_override") {
    return { status: 400, body: { error: "Override voting is not open for this bill" } };
  }
  const overrideAcceptGameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" });
  const overrideAcceptTurn = overrideAcceptGameState?.currentTurn ?? 0;
  if (
    isVotingDeadlinePassed(
      bill.overrideVotingEndsAt,
      now,
      bill.overrideVotingEndsOnTurn,
      overrideAcceptTurn
    )
  ) {
    return { status: 400, body: { error: "Override voting has ended" } };
  }

  const charId = character._id.toString();
  const updateResult = await db.collection<StateBill>("stateBills").updateOne(
    { _id: bill._id, status: "veto_override" },
    buildEmbeddedVoteTallyUpdate({
      voteField: "overrideVotes",
      voteKey: charId,
      vote,
      tallyFieldByVote: {
        for: "overrideVotesFor",
        against: "overrideVotesAgainst",
      },
      updatedAt: now,
      weight: seatsHeld,
    })
  );
  if (updateResult.matchedCount === 0) {
    return {
      status: 409,
      body: { error: "This bill changed before your override vote could be recorded" },
    };
  }

  return { status: 200, body: { success: true, vote, seatsHeld } };
}

export async function takeStateBillGovernorAction(
  db: Db,
  countryId: CountryId,
  stateId: string,
  billId: string,
  user: AuthUserWithCharacter,
  action: "signed" | "vetoed",
  vetoMessage?: string
): Promise<LegislatureCommandResult> {
  // Regional bills go through the regional chief executive (governor / First
  // Minister / Minister-President / Premier) for assent whenever the office is
  // filled — across presidential AND parliamentary systems alike. When the
  // office is vacant (or none is seated), the vote-resolution phase
  // (resolveStateBillVoting) auto-enacts the bill instead of routing it here,
  // so there is no parliamentary carve-out at this stage.
  stateId = stateId.toUpperCase();
  const character = user.character;
  if (!character) {
    return { status: 400, body: { error: "No character found" } };
  }
  const invalidBillId = validateStateBillId(billId);
  if (invalidBillId) return invalidBillId;

  // Country-aware authorization: the regional chief executive (UK FM, DE
  // Minister-President, JP governor, Mayor of London, …) may act. For an
  // NPP-held office, the holding party's authorized officer (state Chair/Vice,
  // or national Chair/Vice when the state party has neither) may act in their
  // stead — same delegation used by the office's Orders/Legislation tabs.
  const { getRegionalBillAssentTitleForState } = await import("@/lib/constants/countries");
  const { canManageOffice } = await import("@/lib/governorOffice/access");
  const canManage = await canManageOffice(db, countryId, stateId, character._id);
  if (!canManage) {
    return {
      status: 403,
      body: {
        error: `Only the ${getRegionalBillAssentTitleForState(countryId, stateId)} can take action on bills`,
      },
    };
  }

  const bill = await db.collection<StateBill>("stateBills").findOne({
    _id: new ObjectId(billId),
    stateId,
  });
  if (!bill) {
    return { status: 404, body: { error: "Bill not found" } };
  }

  if (bill.status !== "passed") {
    return { status: 400, body: { error: "Bill is not awaiting Governor action" } };
  }

  const now = new Date();
  if (action === "signed") {
    // State budget hard gate (audit S6): reject the sign action up-front with a
    // clear error instead of letting an unfundable bill enact. The same gate
    // runs again inside finalizeStateBillEnactment as the safety net for every
    // other enactment path.
    if (bill.legislationTypeId || bill.provisions?.length) {
      const { validateStateBudgetImpact } = await import("@/lib/budget/validation");
      const budgetResult = await validateStateBudgetImpact(db, stateId, countryId, bill);
      if (!budgetResult.allowed) {
        return {
          status: 400,
          body: {
            error: `Cannot sign: the state cannot fund this bill (shortfall $${Math.round((budgetResult.shortfall ?? 0) / 1_000_000)}M).`,
          },
        };
      }
    }

    await db.collection<StateBill>("stateBills").updateOne(
      { _id: bill._id },
      {
        $set: {
          status: "enacted",
          governorAction: "signed",
          enactedAt: now,
          updatedAt: now,
        },
      }
    );

    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 1;
    const outcome = await finalizeStateBillEnactment(db, bill, currentTurn);
    if (!outcome.enacted) {
      // Race safety net: the internal gate rejected between the pre-check above
      // and finalization. The bill is already marked failed with budgetRejection.
      return {
        status: 409,
        body: { error: "The state can no longer fund this bill, so it was not enacted." },
      };
    }

    if (bill.sponsorId) {
      const sponsor = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
      if (sponsor) {
        await createNotification({
          userId: sponsor.userId,
          type: "bill_signed",
          title: "Bill Signed Into Law",
          message: `Your bill "${bill.title}" has been signed by the Governor and is now law.`,
          metadata: { billId: bill._id.toString(), stateId },
        });
      }
    }

    // bill.sponsorName is the source of truth (set on creation): it's the
    // character name for member-sponsored bills, the NPP name for
    // governor-queued bills (sponsorId is null in that case).
    const sponsorName = bill.sponsorId
      ? ((
          await db
            .collection<Character>("characters")
            .findOne({ _id: bill.sponsorId }, { projection: { name: 1 } })
        )?.name ??
        bill.sponsorName ??
        "Unknown")
      : (bill.sponsorName ?? "Unknown");
    generateBillSignedNews(bill.title, sponsorName, "state", stateId).catch((error) =>
      console.error("[News] Failed to generate state bill news:", error)
    );

    return { status: 200, body: { success: true, action: "signed", statusText: "enacted" } };
  }

  const overrideVotingEndsAt = new Date(now.getTime() + OVERRIDE_VOTING_HOURS * 3_600_000);
  const vetoGameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const vetoTurn = vetoGameState?.currentTurn ?? 1;
  const overrideVotingEndsOnTurn = vetoTurn + OVERRIDE_VOTING_HOURS;
  const trimmedVetoMessage = vetoMessage?.trim();
  await db.collection<StateBill>("stateBills").updateOne(
    { _id: bill._id },
    {
      $set: {
        status: "veto_override",
        governorAction: "vetoed",
        overrideVotingStartedAt: now,
        overrideVotingEndsAt,
        overrideVotingEndsOnTurn,
        overrideVotesFor: 0,
        overrideVotesAgainst: 0,
        overrideVotes: {},
        ...(trimmedVetoMessage ? { vetoMessage: trimmedVetoMessage } : {}),
        vetoedByCharacterId: character._id,
        vetoedAtTurn: vetoTurn,
        updatedAt: now,
      },
    }
  );

  if (bill.sponsorId) {
    const sponsor = await db
      .collection<Character>("characters")
      .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
    if (sponsor) {
      await createNotification({
        userId: sponsor.userId,
        type: "bill_vetoed",
        title: "Bill Vetoed",
        message: `Your bill "${bill.title}" has been vetoed by the Governor. Override voting is now open.`,
        metadata: { billId: bill._id.toString(), stateId },
      });
    }
  }

  generateBillVetoedNews(bill.title, "state", stateId, countryId).catch((error) =>
    console.error("[News] Failed to generate state veto news:", error)
  );

  return {
    status: 200,
    body: {
      success: true,
      action: "vetoed",
      statusText: "veto_override",
      overrideVotingEndsAt: overrideVotingEndsAt.toISOString(),
    },
  };
}
