import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Election, NPP, ElectionCandidate, PoliticalParty, State } from "@/lib/db/types";
import type { InfluenceType } from "@/lib/db/types";
import type { ExecutePartyInfluenceInput } from "./partyExecutorTypes";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";
import { activeNppElectionCandidacyFilter } from "@/lib/elections/nppCandidacyQuery";
import { describeNppRelocationCleanup, performNppRelocation } from "@/lib/npp/performNppRelocation";
import {
  getEndorsementDecisionPhase,
  isSelfEndorsementCandidate,
  nppCanPlausiblyEndorseElection,
  upsertNppEndorsement,
} from "@/lib/nppEndorsements";
import { advertiseFavorabilityGain, campaignInfluenceGain } from "@/lib/actions";

// Loyalty and stubbornness have no per-turn decay, so their boosts stay flat.
// Influence and favorability DO decay every turn (see actionRefresh), so their
// boosts use the diminishing curves below instead of a flat amount.
const STAT_CHANGE_AMOUNTS: Record<string, { min: number; max: number }> = {
  boost_loyalty: { min: 1, max: 3 },
  reduce_stubbornness: { min: 1, max: 3 },
};

function calculateStatChange(influenceType: InfluenceType): number {
  const range = STAT_CHANGE_AMOUNTS[influenceType];
  if (!range) return 0;
  return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
}

/** Round a stat delta to the 0.1 grid so boost messages/values stay clean. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface ApplyPartyInfluenceEffectsResult {
  statChange?: number;
  withdrawApplied?: boolean;
  messageOverride?: string;
}

export async function applyPartyInfluenceEffects(
  input: ExecutePartyInfluenceInput,
  npp: NPP,
  party: PoliticalParty
): Promise<ApplyPartyInfluenceEffectsResult> {
  const db = await getDb();
  const now = new Date();

  switch (input.influenceType) {
    case "boost_favorability": {
      // Diminishing toward the cap, same curve as an NPP's own advertise, so a
      // chair boost cannot out-run the favorability decay and pin an NPP at 100
      // (favorability decays by (fav-60)*0.05/turn in actionRefresh).
      const change = round1(advertiseFavorabilityGain(npp.favorability ?? 0));
      const newValue = Math.min(100, (npp.favorability ?? 0) + change);
      await db
        .collection<NPP>("npps")
        .updateOne({ _id: npp._id }, { $set: { favorability: newValue, updatedAt: now } });
      return { statChange: change };
    }
    case "boost_influence": {
      // Diminishing toward the cap, same curve as an NPP's own campaign, so a
      // chair boost cannot out-run the 0.75%/turn PI decay and pin an NPP at 100.
      const change = round1(campaignInfluenceGain(npp.politicalInfluence ?? 0));
      const newValue = Math.min(100, (npp.politicalInfluence ?? 0) + change);
      await db
        .collection<NPP>("npps")
        .updateOne({ _id: npp._id }, { $set: { politicalInfluence: newValue, updatedAt: now } });
      return { statChange: change };
    }
    case "boost_loyalty": {
      const change = calculateStatChange("boost_loyalty");
      const newValue = Math.min(100, npp.personality.loyalty + change);
      await db
        .collection<NPP>("npps")
        .updateOne({ _id: npp._id }, { $set: { "personality.loyalty": newValue, updatedAt: now } });
      return { statChange: change };
    }
    case "reduce_stubbornness": {
      const change = calculateStatChange("reduce_stubbornness");
      const newValue = Math.max(0, npp.personality.stubbornness - change);
      await db
        .collection<NPP>("npps")
        .updateOne(
          { _id: npp._id },
          { $set: { "personality.stubbornness": newValue, updatedAt: now } }
        );
      return { statChange: change };
    }
    case "relocate_state": {
      const targetStateId = input.context.targetStateId;
      if (!targetStateId) return {};

      const targetState = await db
        .collection<State>("states")
        .findOne({ _id: targetStateId, countryId: party.countryId });
      if (!targetState) {
        return {};
      }

      const outcome = await performNppRelocation(db, npp, targetState, now);
      const cleanupNotes = describeNppRelocationCleanup(outcome);

      return {
        messageOverride: `${npp.name} has agreed to relocate to ${targetState.name} at the ${party.name}'s request${
          cleanupNotes.length > 0 ? ` and ${cleanupNotes.join(" and ")}` : ""
        }.`,
      };
    }
    case "endorse_candidate": {
      if (!input.context.electionId || !input.context.candidateId) break;

      const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
        _id: new ObjectId(input.context.candidateId),
        status: "active",
      });
      if (candidate) {
        const [election, candidateCountAtDecision] = await Promise.all([
          db.collection<Election>("elections").findOne({ _id: candidate.electionId }),
          db
            .collection<ElectionCandidate>("electionCandidates")
            .countDocuments({ electionId: candidate.electionId, status: "active" }),
        ]);
        if (
          election &&
          !isSelfEndorsementCandidate(npp, candidate) &&
          nppCanPlausiblyEndorseElection(npp, election)
        ) {
          const gameState = await db
            .collection<{ _id: string; currentTurn?: number }>("gameState")
            .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
          await upsertNppEndorsement(db, {
            npp,
            candidate,
            source: "arranged",
            now,
            currentTurn: gameState?.currentTurn ?? 0,
            candidateCountAtDecision,
            electionPhaseAtDecision: getEndorsementDecisionPhase(
              election,
              gameState?.currentTurn ?? 0,
              now
            ),
            arrangedBy: input.actorCharacterId,
            arrangedByParty: String(party.sequentialId),
          });
        }
      }
      return {};
    }
    case "withdraw_election": {
      if (!input.context.electionId) return { withdrawApplied: false };

      const electionObjId = new ObjectId(input.context.electionId);
      const filter = activeNppElectionCandidacyFilter(electionObjId, npp._id);
      const withdrawCandidate = await db
        .collection<ElectionCandidate>("electionCandidates")
        .findOne(filter);

      if (!withdrawCandidate) return { withdrawApplied: false };

      const updateResult = await db.collection<ElectionCandidate>("electionCandidates").updateOne(
        { _id: withdrawCandidate._id },
        {
          $set: {
            status: "withdrawn",
            withdrawnAt: now,
          },
        }
      );

      if (updateResult.modifiedCount === 0) return { withdrawApplied: false };

      await removeWithdrawnCandidateFromTally(db, electionObjId, withdrawCandidate._id.toString());
      return { withdrawApplied: true };
    }
    case "oppose_candidate":
    case "support_leadership":
      return {};
  }

  return {};
}
