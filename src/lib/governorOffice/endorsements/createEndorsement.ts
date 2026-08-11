import type { Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import type {
  Character,
  GovernorEndorsement,
  GovernorOfficeState,
  Election,
  ElectionCandidate,
} from "@/lib/db/types";
import {
  getRegionalExecutiveOfficeKey,
  getEndorseableElectionTypes,
  type CountryId,
} from "@/lib/constants/countries";
import { GOVERNOR_ENDORSEMENT_ACTION_COST } from "@/lib/constants/governorOffice";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { applyEndorsementSupportBump } from "@/lib/turn/elections/supportEvents";
import { partiesMatchInCountry } from "@/lib/parties/partyMatch";

export interface CreateEndorsementInput {
  countryId: CountryId;
  stateId: string;
  character: { _id: ObjectId; name: string; party?: string };
  electionId: ObjectId;
  candidateId: ObjectId;
}

/**
 * Office-side endorsement of a state-level candidate by the regional executive.
 * Distinct from PlayerEndorsement so the campaign-turn pipeline can weight
 * governor endorsements separately (and apply them at state level instead of
 * presidential-only).
 */
export async function createEndorsement(
  db: Db,
  input: CreateEndorsementInput
): Promise<{ status: number; body: { endorsementId?: string; error?: string } }> {
  const { countryId, stateId, character, electionId, candidateId } = input;

  const election = await db.collection<Election>("elections").findOne({ _id: electionId });
  if (!election || election.status !== "active") {
    return { status: 400, body: { error: "Election is not active." } };
  }
  // Presidential is national — `election.state` is "US" / country code, not
  // the governor's state. A governor's endorsement of a presidential race is
  // still meaningful (delegates / electoral votes from their state are at
  // stake), so we skip the state-match check for that electionType.
  if (election.electionType !== "president" && election.state !== stateId) {
    return { status: 400, body: { error: "Cross-state endorsements are not permitted." } };
  }
  if (election.countryId !== countryId) {
    return { status: 400, body: { error: "Cross-country endorsements are not permitted." } };
  }

  // Endorseable from this seat: the country's sub-national legislature plus
  // any elected federal chambers (US House/Senate, UK Commons, DE Bundestag,
  // JP Shugiin/Sangiin). All filtered to races within the governor's own
  // state via `election.state`. Self-endorsement in their own re-election
  // is explicitly excluded.
  const allowed = new Set<string>(getEndorseableElectionTypes(countryId));
  const executiveKey = getRegionalExecutiveOfficeKey(countryId);
  if (election.electionType === executiveKey) {
    return { status: 400, body: { error: "Cannot endorse in your own re-election." } };
  }
  if (!allowed.has(election.electionType)) {
    return {
      status: 400,
      body: { error: "This race is not endorseable from the governor's office." },
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

  // One active endorsement per (governor, race).
  const existing = await db.collection<GovernorEndorsement>("governorEndorsements").findOne({
    countryId,
    stateId,
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

  // Office AP spend (matches Address, Orders, Queue Bill). Atomic guard
  // against insufficient balance via $gte filter.
  const spend = await db.collection<GovernorOfficeState>("governorOfficeState").updateOne(
    {
      countryId,
      stateId,
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
  const doc: GovernorEndorsement = {
    _id: id,
    countryId,
    stateId,
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
  await db.collection<GovernorEndorsement>("governorEndorsements").insertOne(doc);

  // B3 — endorsement landing bumps the endorsed candidate's Support.
  if (candidate.characterId && !candidate.isNPP) {
    await applyEndorsementSupportBump(db, candidate.characterId);
  }

  return { status: 200, body: { endorsementId: id.toString() } };
}
