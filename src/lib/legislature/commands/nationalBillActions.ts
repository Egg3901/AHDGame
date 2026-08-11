import type { AuthUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit/recordAudit";
import type { LegislatureCommandResult } from "@/lib/legislature/commands/types";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { applyBillVotePolicyShift } from "@/lib/policyShift";
import { executePresidentialBillAction } from "@/lib/presidentialBillAction";
import { createNotification } from "@/lib/notifications";
import { clearWhippedFromVote } from "@/lib/congress/clearWhippedVote";
import { buildEmbeddedVoteTallyUpdate } from "@/lib/votes/embeddedVoteTally";
import { isVotingDeadlinePassed } from "@/lib/legislature/billVotingWindow";
import { getGameState } from "@/lib/gameState";
import type { Bill, Character, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { statMultiplier } from "@/lib/stats/statMultiplier";
import { NEUTRAL_STAT, USE_GROWTH_INCREMENT } from "@/lib/stats/statsConstants";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

export type NationalBillActionInput =
  | { action: "vote"; vote: "for" | "against" | "abstain" }
  | { action: "veto_override_vote"; vote: "for" | "against" }
  | { action: "cosponsor" }
  | { action: "uncosponsor" }
  | { action: "withdraw" }
  | { action: "presidential_action"; decision: "sign" | "veto"; vetoMessage?: string }
  | { action: "filibuster" };

export async function performNationalBillAction(
  db: Db,
  {
    authUser,
    character,
    bill,
    countryId,
    input,
  }: {
    authUser: AuthUser;
    character: Character;
    bill: Bill;
    countryId: CountryId;
    input: NationalBillActionInput;
  }
): Promise<LegislatureCommandResult> {
  const now = new Date();
  const gameState = await getGameState(db);
  const currentTurn = gameState?.currentTurn ?? 0;
  const preset = gameState?.preset;
  const config = getCountryConfig(countryId, preset);
  const lowerKey = config.legislature.lowerChamber.key;
  const upperKey = config.upperElectionSystem
    ? (config.legislature.upperChamber?.key ?? null)
    : null;
  const chamberKeys = upperKey ? [lowerKey, upperKey] : [lowerKey];
  // Office types seated members are stored under. Identical to the chamber keys
  // for every country except CN ("npc" chamber → "npcDelegate" office), so
  // querying electedOfficials by the raw chamber key matched no CN delegates and
  // blocked them from voting on / co-sponsoring their own bills.
  const chamberOfficeTypes = chamberKeys.map((key) =>
    getOfficeTypeForChamber(countryId, key, preset)
  );
  const action = input.action;

  // One-party-state guard: banned parties cannot vote on or co-sponsor bills.
  // Placed before action branching so every interactive action surface is
  // covered (vote, cosponsor, filibuster, veto_override_vote).
  // Reads runtime governmentType so post-Stage-4 conversion immediately
  // lifts the banned-party restriction.
  const runtimeState = await getCountryState(db, countryId);
  if (runtimeState.governmentType === "onePartyState" && character.party) {
    const voterParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parseInt(character.party, 10), countryId });
    if (isBannedParty(config, voterParty)) {
      return {
        status: 403,
        body: { error: "Banned parties cannot vote on or act on legislation." },
      };
    }
  }

  if (action === "vote") {
    const { vote } = input;
    const charKey = character._id.toString();
    const isCabinetReview = bill.status === "cabinet_review";
    const isOtherChamber = bill.status === "active_other";
    // JP `override_shugiin` reuses the main votes / votingEndsAt fields exactly
    // like a fresh "active" vote — handle it through the same code path.
    const isJpOverride = bill.status === "override_shugiin";
    const isOrigin = bill.status === "active" || isJpOverride;

    if (!isCabinetReview && !isOrigin && !isOtherChamber) {
      return {
        status: 409,
        body: { error: "This bill is not currently open for voting." },
      };
    }

    if (
      (isCabinetReview || isOrigin) &&
      isVotingDeadlinePassed(bill.votingEndsAt, now, bill.votingEndsOnTurn, currentTurn)
    ) {
      return { status: 409, body: { error: "Voting has ended for this bill." } };
    }
    if (
      isOtherChamber &&
      isVotingDeadlinePassed(
        bill.otherChamberVotingEndsAt,
        now,
        bill.otherChamberVotingEndsOnTurn,
        currentTurn
      )
    ) {
      return { status: 409, body: { error: "Voting has ended for this bill." } };
    }

    if (isCabinetReview) {
      if (vote === "abstain") {
        return {
          status: 400,
          body: { error: "Cabinet review votes must be for or against." },
        };
      }

      const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
      const isPM = govFormation?.pmCharacterId?.equals(character._id) ?? false;
      const cabinetMember = isPM
        ? null
        : await db.collection("cabinetMembers").findOne({ characterId: character._id, countryId });

      if (!isPM && !cabinetMember) {
        return {
          status: 403,
          body: { error: "Only the PM or cabinet members can vote on cabinet bills." },
        };
      }

      if (bill.votes?.[charKey]) {
        return {
          status: 409,
          body: { error: "You have already voted on this cabinet bill." },
        };
      }

      const voteResult = await db.collection<Bill>("bills").updateOne(
        {
          _id: bill._id,
          status: "cabinet_review",
          [`votes.${charKey}`]: { $exists: false },
        },
        {
          $set: { [`votes.${charKey}`]: vote, updatedAt: now },
          $inc: { [vote === "for" ? "votesFor" : "votesAgainst"]: 1 },
        }
      );
      if (voteResult.modifiedCount === 0) {
        return {
          status: 409,
          body: { error: "You have already voted on this cabinet bill." },
        };
      }

      recordAudit({
        source: "api",
        action: "vote.cast",
        category: "governance",
        subject: { type: "bill", id: bill._id.toString(), name: bill.title },
        refs: { billId: bill._id },
        meta: { vote, chamber: "cabinet_review", countryId },
        outcome: "ok",
      });

      return { status: 200, body: { message: `Vote recorded: ${vote}.` } };
    }

    const chamberType = bill.currentChamber === "joint" ? lowerKey : bill.currentChamber;
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: getOfficeTypeForChamber(countryId, chamberType),
      countryId,
    });
    if (!official) {
      const chamberLabel =
        config.legislature.lowerChamber.key === chamberType
          ? config.legislature.lowerChamber.shortName
          : (config.legislature.upperChamber?.shortName ?? "");
      return {
        status: 403,
        body: { error: `Only ${chamberLabel} members can vote on this bill.` },
      };
    }

    const weight = official.seatsHeld ?? 1;

    if (isOtherChamber) {
      const voteResult = await db.collection<Bill>("bills").updateOne(
        { _id: bill._id, status: "active_other" },
        buildEmbeddedVoteTallyUpdate({
          voteField: "otherChamberVotes",
          voteKey: charKey,
          vote,
          tallyFieldByVote: {
            for: "otherChamberVotesFor",
            against: "otherChamberVotesAgainst",
            abstain: "otherChamberVotesAbstain",
          },
          updatedAt: now,
          weight,
        })
      );
      if (voteResult.matchedCount === 0) {
        return {
          status: 409,
          body: { error: "This bill changed before your vote could be recorded." },
        };
      }
      await clearWhippedFromVote(
        db,
        "bills",
        bill._id,
        character._id,
        "otherChamberWhippedFromVote"
      );
    } else {
      const voteResult = await db.collection<Bill>("bills").updateOne(
        { _id: bill._id, status: isJpOverride ? "override_shugiin" : "active" },
        buildEmbeddedVoteTallyUpdate({
          voteField: "votes",
          voteKey: charKey,
          vote,
          tallyFieldByVote: {
            for: "votesFor",
            against: "votesAgainst",
            abstain: "votesAbstain",
          },
          updatedAt: now,
          weight,
        })
      );
      if (voteResult.matchedCount === 0) {
        return {
          status: 409,
          body: { error: "This bill changed before your vote could be recorded." },
        };
      }
      await clearWhippedFromVote(db, "bills", bill._id, character._id);
    }

    recordAudit({
      source: "api",
      action: "vote.cast",
      category: "governance",
      subject: { type: "bill", id: bill._id.toString(), name: bill.title },
      refs: { billId: bill._id },
      meta: { vote, chamber: isOtherChamber ? "other" : "origin", weight, countryId },
      outcome: "ok",
    });

    const previousVote = isOtherChamber ? bill.otherChamberVotes?.[charKey] : bill.votes?.[charKey];
    if (!previousVote || previousVote === "abstain") {
      try {
        await applyBillVotePolicyShift(
          db,
          character._id,
          (bill.provisions ?? []).filter(isPolicyProvision),
          vote,
          character.policies
        );
      } catch (error) {
        console.warn("[policyShift] Failed to apply policy shift from congress vote:", error);
      }
    }

    return { status: 200, body: { message: `Vote recorded: ${vote}.` } };
  }

  if (action === "veto_override_vote") {
    const { vote } = input;
    if (bill.status !== "veto_override") {
      return {
        status: 409,
        body: { error: "This bill is not currently in a veto override vote." },
      };
    }
    if (
      isVotingDeadlinePassed(
        bill.overrideVotingEndsAt,
        now,
        bill.overrideVotingEndsOnTurn,
        currentTurn
      )
    ) {
      return {
        status: 409,
        body: { error: "Override voting has ended for this bill." },
      };
    }

    const memberOfEither = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: { $in: chamberOfficeTypes },
      countryId,
    });
    if (!memberOfEither) {
      return {
        status: 403,
        body: { error: `Only ${config.legislature.name} members can vote on a veto override.` },
      };
    }

    const charKey = character._id.toString();
    const overrideWeight = memberOfEither.seatsHeld ?? 1;
    const voteResult = await db.collection<Bill>("bills").updateOne(
      { _id: bill._id, status: "veto_override" },
      buildEmbeddedVoteTallyUpdate({
        voteField: "vetoOverrideVotes",
        voteKey: charKey,
        vote,
        tallyFieldByVote: {
          for: "vetoOverrideVotesFor",
          against: "vetoOverrideVotesAgainst",
        },
        updatedAt: now,
        weight: overrideWeight,
      })
    );
    if (voteResult.matchedCount === 0) {
      return {
        status: 409,
        body: { error: "This bill changed before your override vote could be recorded." },
      };
    }
    await clearWhippedFromVote(db, "bills", bill._id, character._id, "vetoOverrideWhippedFromVote");

    recordAudit({
      source: "api",
      action: "vote.cast",
      category: "governance",
      subject: { type: "bill", id: bill._id.toString(), name: bill.title },
      refs: { billId: bill._id },
      meta: { vote, chamber: "veto_override", weight: overrideWeight, countryId },
      outcome: "ok",
    });

    return { status: 200, body: { message: `Override vote recorded: ${vote}.` } };
  }

  if (action === "cosponsor") {
    if (bill.sponsorId?.toString() === character._id.toString()) {
      return { status: 409, body: { error: "You are the sponsor." } };
    }
    if (
      (bill.coSponsors ?? []).some(
        (entry) => entry.characterId.toString() === character._id.toString()
      )
    ) {
      return { status: 409, body: { error: "You are already a co-sponsor." } };
    }
    if (!["active", "proposed"].includes(bill.status)) {
      return {
        status: 409,
        body: { error: "Cannot co-sponsor a bill that is no longer active." },
      };
    }
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: { $in: chamberOfficeTypes },
      countryId,
    });
    if (!official) {
      return {
        status: 403,
        body: { error: `Only ${config.legislature.name} members can co-sponsor.` },
      };
    }

    await db.collection<Bill>("bills").updateOne(
      { _id: bill._id },
      {
        $push: { coSponsors: { characterId: character._id, characterName: character.name } },
        $set: { updatedAt: now },
      }
    );
    try {
      const { awardAchievement } = await import("@/lib/achievements");
      await awardAchievement(new ObjectId(authUser.userId), "cosponsor", character._id);
    } catch (error) {
      console.error(
        JSON.stringify({
          error: "achievement_check_failed",
          operation: "bill_cosponsor_achievement",
          timestamp: new Date().toISOString(),
          details: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
    return { status: 200, body: { message: `${character.name} added as co-sponsor.` } };
  }

  if (action === "uncosponsor") {
    const isCosponsor = (bill.coSponsors ?? []).some(
      (entry) => entry.characterId.toString() === character._id.toString()
    );
    if (!isCosponsor) {
      return { status: 409, body: { error: "You are not a co-sponsor of this bill." } };
    }
    if (!["active", "proposed"].includes(bill.status)) {
      return {
        status: 409,
        body: {
          error: "Cannot change co-sponsorship on a bill that is no longer in proposal or voting.",
        },
      };
    }

    await db.collection<Bill>("bills").updateOne(
      { _id: bill._id },
      {
        $pull: { coSponsors: { characterId: character._id } },
        $set: { updatedAt: now },
      }
    );
    return { status: 200, body: { message: "Your co-sponsorship has been removed." } };
  }

  if (action === "withdraw") {
    if (bill.sponsorId?.toString() !== character._id.toString()) {
      return { status: 403, body: { error: "Only the sponsor can withdraw a bill." } };
    }
    if (bill.status !== "proposed" && bill.status !== "active") {
      return {
        status: 409,
        body: {
          error: "A bill can only be withdrawn while in proposal or initial voting stage.",
        },
      };
    }
    await db
      .collection<Bill>("bills")
      .updateOne({ _id: bill._id }, { $set: { status: "withdrawn", updatedAt: now } });

    recordAudit({
      source: "api",
      action: "bill.withdraw",
      category: "governance",
      subject: { type: "bill", id: bill._id.toString(), name: bill.title },
      refs: { billId: bill._id },
      meta: { countryId },
      outcome: "ok",
    });

    return { status: 200, body: { message: "Bill withdrawn." } };
  }

  if (action === "presidential_action") {
    const presOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: "president",
      countryId,
    });
    if (!presOfficial) {
      return {
        status: 403,
        body: { error: "Only the President can sign or veto bills." },
      };
    }
    const result = await executePresidentialBillAction(
      db,
      bill._id,
      character._id,
      input.decision,
      input.vetoMessage
    );
    if (!result.success) {
      return {
        status: result.error === "Bill not found" ? 404 : 409,
        body: { error: result.error },
      };
    }
    return { status: 200, body: { message: result.message } };
  }

  if (action === "filibuster") {
    if (countryId !== "US") {
      return {
        status: 400,
        body: { error: "Filibuster is only available in the US Senate." },
      };
    }

    const isSenateOrigin = bill.status === "active" && bill.currentChamber === "senate";
    const isSenateOther = bill.status === "active_other" && bill.currentChamber === "senate";
    if (!isSenateOrigin && !isSenateOther) {
      return {
        status: 409,
        body: {
          error: "Filibuster can only be invoked on a bill actively being voted on in the Senate.",
        },
      };
    }

    const senateOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: character._id,
      officeType: "senate",
      countryId,
    });
    if (!senateOfficial) {
      return { status: 403, body: { error: "Only US Senators can invoke the filibuster." } };
    }

    const filibusterPolicy = await db
      .collection("statePolicies")
      .findOne({ stateId: "federal", legislationTypeId: "senate_filibuster_rules" });
    if (filibusterPolicy && filibusterPolicy.effectDirection === -1) {
      return {
        status: 409,
        body: {
          error: "The filibuster has been abolished by Senate rules. Simple majority applies.",
        },
      };
    }

    const alreadyFilibustered = (bill.filibusterInvocations ?? []).some(
      (entry) => entry.characterId === character._id.toString()
    );
    if (alreadyFilibustered) {
      return { status: 409, body: { error: "You have already filibustered this bill." } };
    }

    const filibusterActionCost = 25;
    const filibusterNpiCost = 5;
    if ((character.actions ?? 0) < filibusterActionCost) {
      return {
        status: 409,
        body: {
          error: `You need at least ${filibusterActionCost} action points to invoke the filibuster.`,
        },
      };
    }
    if ((character.politicalInfluence ?? 0) < filibusterNpiCost) {
      return {
        status: 409,
        body: { error: `You need at least ${filibusterNpiCost} NPI to invoke the filibuster.` },
      };
    }

    // Statecraft lengthens (or, when weak, shortens) the filibuster delay by the
    // gentle ±20% efficacy band. Unmigrated characters use the neutral 1.0×.
    const filibusterDelayMs = Math.round(
      12 * 60 * 60 * 1000 * statMultiplier(character.stats?.statecraft ?? NEUTRAL_STAT)
    );
    const deadlineField = isSenateOther ? "otherChamberVotingEndsAt" : "votingEndsAt";
    // The lifecycle close query and vote gating both prefer the turn-number
    // deadline when it exists, so the turn field must move in lockstep with the
    // date — extending only the date made the promised 12h a no-op (#3199).
    const deadlineTurnField = isSenateOther ? "otherChamberVotingEndsOnTurn" : "votingEndsOnTurn";
    const filibusterDelayTurns = Math.max(1, Math.round(filibusterDelayMs / (60 * 60 * 1000)));
    const invocationRecord = {
      characterId: character._id.toString(),
      characterName: character.name,
      invokedAt: now,
    };

    const spendResult = await db.collection("characters").updateOne(
      {
        _id: character._id,
        actions: { $gte: filibusterActionCost },
        politicalInfluence: { $gte: filibusterNpiCost },
      },
      {
        $inc: {
          actions: -filibusterActionCost,
          politicalInfluence: -filibusterNpiCost,
          // Use-growth: invoking the filibuster trains Statecraft (flushed each turn).
          ...(character.stats ? { "statXp.statecraft": USE_GROWTH_INCREMENT } : {}),
        },
      }
    );
    if (spendResult.modifiedCount === 0) {
      return {
        status: 409,
        body: { error: "Your actions or NPI changed before the filibuster could be processed." },
      };
    }

    const filibusterResult = await db.collection<Bill>("bills").updateOne(
      {
        _id: bill._id,
        "filibusterInvocations.characterId": { $ne: character._id.toString() },
      },
      [
        {
          $set: {
            [deadlineField]: {
              $dateAdd: {
                startDate: { $ifNull: [`$${deadlineField}`, now] },
                unit: "millisecond",
                amount: filibusterDelayMs,
              },
            },
            // Legacy bills without a turn deadline keep relying on the date
            // fallback — only bump the turn field when it exists ($$REMOVE keeps
            // it absent rather than writing null).
            [deadlineTurnField]: {
              $cond: [
                { $isNumber: `$${deadlineTurnField}` },
                { $add: [`$${deadlineTurnField}`, filibusterDelayTurns] },
                "$$REMOVE",
              ],
            },
            updatedAt: now,
            filibusterInvocations: {
              $concatArrays: [{ $ifNull: ["$filibusterInvocations", []] }, [invocationRecord]],
            },
          },
        },
      ]
    );

    if (filibusterResult.modifiedCount === 0) {
      await db
        .collection("characters")
        .updateOne(
          { _id: character._id },
          { $inc: { actions: filibusterActionCost, politicalInfluence: filibusterNpiCost } }
        );
      return {
        status: 409,
        body: {
          error: "This bill's filibuster state changed before your action could be applied.",
        },
      };
    }

    if (bill.sponsorId) {
      const sponsorChar = await db
        .collection<Character>("characters")
        .findOne({ _id: bill.sponsorId }, { projection: { userId: 1 } });
      if (sponsorChar) {
        await createNotification({
          userId: sponsorChar.userId,
          type: "system",
          title: "Bill Filibustered",
          message: `Senator ${character.name} has filibustered "${bill.title}". The vote deadline has been extended by 12 hours and 3/5 of votes cast are now required to pass.`,
          metadata: { billId: bill._id.toString() },
        });
      }
    }

    recordAudit({
      source: "api",
      action: "bill.filibuster",
      category: "governance",
      subject: { type: "bill", id: bill._id.toString(), name: bill.title },
      refs: { billId: bill._id },
      meta: { countryId, delayMs: filibusterDelayMs },
      outcome: "ok",
    });

    return {
      status: 200,
      body: {
        message:
          "Filibuster invoked. Vote deadline extended 12 hours. This bill now needs 3/5 of votes cast to pass.",
      },
    };
  }

  return { status: 400, body: { error: "Invalid action." } };
}
