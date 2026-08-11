import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import type {
  Character,
  ExecutiveEndorsement,
  GovernorOfficeState,
  Election,
  ElectionCandidate,
} from "@/lib/db/types";
import { getExecutiveEndorseableElectionTypes, type CountryId } from "@/lib/constants/countries";
import { GOVERNOR_ENDORSEMENT_ACTION_COST } from "@/lib/constants/governorOffice";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { applyEndorsementSupportBump } from "@/lib/turn/elections/supportEvents";
import { partiesMatchInCountry } from "@/lib/parties/partyMatch";

export interface CreateExecutiveEndorsementInput {
  countryId: CountryId;
  character: { _id: ObjectId; name: string; party?: string };
  electionId: ObjectId;
  candidateId: ObjectId;
}

/**
 * Office-side endorsement issued from the head-of-government (President /
 * PM / Chancellor) for a sub-presidential race. Mirrors `createEndorsement`
 * for governors, with these differences:
 *   - Spend comes from the national pseudo-stateId Office AP row, not a
 *     state-scoped one.
 *   - Cross-state check is dropped — the leader endorses races across the
 *     whole country (state filter happens UI-side).
 *   - Endorseable race-type set excludes the national executive itself
 *     (no self-endorsement) but includes regional executives (Governor /
 *     Minister-President).
 */
export async function createExecutiveEndorsement(
  db: Db,
  input: CreateExecutiveEndorsementInput
): Promise<{ status: number; body: { endorsementId?: string; error?: string } }> {
  const { countryId, character, electionId, candidateId } = input;

  const election = await db.collection<Election>("elections").findOne({ _id: electionId });
  if (!election || election.status !== "active") {
    return { status: 400, body: { error: "Election is not active." } };
  }
  if (election.countryId !== countryId) {
    return { status: 400, body: { error: "Cross-country endorsements are not permitted." } };
  }

  const allowed = new Set<string>(getExecutiveEndorseableElectionTypes(countryId));
  if (!allowed.has(election.electionType)) {
    return {
      status: 400,
      body: { error: "This race is not endorseable from the executive's office." },
    };
  }

  const candidate = await db
    .collection<ElectionCandidate>("electionCandidates")
    .findOne({ _id: candidateId, electionId });
  if (!candidate || candidate.status !== "active") {
    return { status: 400, body: { error: "Candidate is not active." } };
  }
  let candidateParty = candidate.party;
  if (!candidate.isNPP && candidate.characterId) {
    const candChar = await db
      .collection<Character>("characters")
      .findOne({ _id: candidate.characterId }, { projection: { party: 1 } });
    if (candChar?.party) candidateParty = candChar.party;
  }
  const sameParty = await partiesMatchInCountry(db, countryId, character.party, candidateParty);
  if (!sameParty) {
    return { status: 400, body: { error: "Cannot endorse across party lines." } };
  }

  // One active endorsement per (leader, race).
  const existing = await db.collection<ExecutiveEndorsement>("executiveEndorsements").findOne({
    countryId,
    endorsedByCharacterId: character._id,
    electionId,
    isActive: true,
  });
  if (existing) {
    return {
      status: 409,
      body: { error: "You already have an active endorsement for this race." },
    };
  }

  // Office AP spend on the national pseudo-stateId row.
  const nationalStateId = getNationalStateId(countryId);
  const spend = await db.collection<GovernorOfficeState>("governorOfficeState").updateOne(
    {
      countryId,
      stateId: nationalStateId,
      gubernatorialActions: { $gte: GOVERNOR_ENDORSEMENT_ACTION_COST },
    },
    {
      $inc: { gubernatorialActions: -GOVERNOR_ENDORSEMENT_ACTION_COST },
      $set: { updatedAt: new Date() },
    }
  );
  if (spend.modifiedCount === 0) {
    return { status: 400, body: { error: "Insufficient office action points." } };
  }

  const id = new MongoObjectId();
  const currentTurn = await getCurrentTurn(db);
  const doc: ExecutiveEndorsement = {
    _id: id,
    countryId,
    targetStateId: election.state ?? nationalStateId,
    endorsedByCharacterId: character._id,
    endorsedByName: character.name,
    electionId,
    candidateId,
    candidateName: candidate.characterName ?? "",
    candidateIsNPP: candidate.isNPP === true,
    candidatePartyId: candidate.party,
    isActive: true,
    createdAtTurn: currentTurn,
    createdAt: new Date(),
  };
  await db.collection<ExecutiveEndorsement>("executiveEndorsements").insertOne(doc);

  // B3 — endorsement landing bumps the endorsed candidate's Support.
  // Use candidate.characterId rather than the param `candidateId`
  // because executiveEndorsements key by the candidate-row id, while
  // applySupportDelta looks up by character id.
  if (candidate.characterId && !candidate.isNPP) {
    await applyEndorsementSupportBump(db, candidate.characterId);
  }

  return { status: 200, body: { endorsementId: id.toString() } };
}
