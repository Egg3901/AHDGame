// GET diagnoses / POST withdraws candidates in active party elections who no longer belong to that party.
// Auth: requireAdmin
// Errors: 401, 500
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type {
  StatePartyElection,
  StatePartyCandidate,
  NationalPartyElection,
  NationalPartyCandidate,
  NationalCommitteeElection,
  NationalCommitteeCandidate,
  Character,
  PoliticalParty,
  State,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

interface OrphanedCandidate {
  candidateId: string;
  characterId: string;
  characterName: string;
  electionType: "state" | "national" | "committee";
  countryId: CountryId;
  partyId: string;
  partyName: string;
  position?: string;
  characterParty: string;
  characterPartyName: string;
}

/**
 * GET /api/admin/heal/party-leadership-elections
 * Diagnose candidates in party elections who are no longer members of that party
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const orphaned: OrphanedCandidate[] = [];

    // Build state → countryId lookup
    const allStates = await db
      .collection<State>("states")
      .find({})
      .project<{ _id: string; countryId: CountryId }>({ _id: 1, countryId: 1 })
      .toArray();
    const stateCountryMap = new Map(allStates.map((s) => [s._id, s.countryId]));
    const getCountryFromState = (stateId: string): CountryId =>
      stateCountryMap.get(stateId) ?? "US";

    // Get all parties for lookup - key by country:sequentialId
    const parties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
    const partyByCountryAndSeqId = new Map<string, PoliticalParty>();
    for (const p of parties) {
      partyByCountryAndSeqId.set(`${p.countryId}:${p.sequentialId}`, p);
    }

    // Helper to resolve party name from sequentialId
    const resolvePartyName = (partyId: string, countryId: CountryId): string => {
      if (partyId === "independent" || !partyId) return "Independent";
      // Look up by sequential ID
      const party = partyByCountryAndSeqId.get(`${countryId}:${partyId}`);
      if (party) return party.name;
      // Return the raw ID if we can't resolve
      return `Party ${partyId}`;
    };

    // Helper to check if character's party matches election party
    // Handles cross-country mismatches and sequential ID comparisons
    const isPartyMismatch = (
      characterParty: string,
      characterCountryId: CountryId,
      electionPartyId: string,
      electionCountryId: CountryId
    ): boolean => {
      if (characterParty === "independent") return true;

      // Different countries = automatic mismatch (cross-country bug)
      if (characterCountryId !== electionCountryId) return true;

      // Same country - compare sequential IDs directly
      if (characterParty === electionPartyId) return false;

      // Fallback: look up full party objects to compare _id
      const charParty = partyByCountryAndSeqId.get(`${characterCountryId}:${characterParty}`);
      const elecParty = partyByCountryAndSeqId.get(`${electionCountryId}:${electionPartyId}`);

      if (charParty && elecParty) {
        return charParty._id.toString() !== elecParty._id.toString();
      }

      // If we can't resolve both, they're mismatched
      return true;
    };

    // 1. Check state party elections
    const activeStateElections = await db
      .collection<StatePartyElection>("statePartyElections")
      .find({ status: "voting" })
      .toArray();

    for (const election of activeStateElections) {
      const countryId = getCountryFromState(election.stateId);
      const candidates = await db
        .collection<StatePartyCandidate>("statePartyCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      for (const candidate of candidates) {
        const character = await db
          .collection<Character>("characters")
          .findOne({ _id: candidate.characterId });

        if (character) {
          const charCountryId = (character.countryId ?? "US") as CountryId;
          if (isPartyMismatch(character.party, charCountryId, election.partyId, countryId)) {
            orphaned.push({
              candidateId: candidate._id.toString(),
              characterId: candidate.characterId.toString(),
              characterName: candidate.characterName,
              electionType: "state",
              countryId,
              partyId: election.partyId,
              partyName: resolvePartyName(election.partyId, countryId),
              position: election.position,
              characterParty: character.party,
              characterPartyName: resolvePartyName(character.party, charCountryId),
            });
          }
        }
      }
    }

    // 2. Check national party elections
    const activeNationalElections = await db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find({ status: "voting" })
      .toArray();

    for (const election of activeNationalElections) {
      const electionCountryId = election.countryId ?? "US";
      const candidates = await db
        .collection<NationalPartyCandidate>("nationalPartyCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      for (const candidate of candidates) {
        const character = await db
          .collection<Character>("characters")
          .findOne({ _id: candidate.characterId });

        if (character) {
          const charCountryId = (character.countryId ?? "US") as CountryId;
          if (
            isPartyMismatch(character.party, charCountryId, election.partyId, electionCountryId)
          ) {
            orphaned.push({
              candidateId: candidate._id.toString(),
              characterId: candidate.characterId.toString(),
              characterName: candidate.characterName,
              electionType: "national",
              countryId: electionCountryId,
              partyId: election.partyId,
              partyName: resolvePartyName(election.partyId, electionCountryId),
              position: election.position,
              characterParty: character.party,
              characterPartyName: resolvePartyName(character.party, charCountryId),
            });
          }
        }
      }
    }

    // 3. Check national committee elections
    const activeCommitteeElections = await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .find({ status: "voting" })
      .toArray();

    for (const election of activeCommitteeElections) {
      const electionCountryId = election.countryId ?? "US";
      const candidates = await db
        .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      for (const candidate of candidates) {
        const character = await db
          .collection<Character>("characters")
          .findOne({ _id: candidate.characterId });

        if (character) {
          const charCountryId = (character.countryId ?? "US") as CountryId;
          if (
            isPartyMismatch(character.party, charCountryId, election.partyId, electionCountryId)
          ) {
            orphaned.push({
              candidateId: candidate._id.toString(),
              characterId: candidate.characterId.toString(),
              characterName: candidate.characterName,
              electionType: "committee",
              countryId: electionCountryId,
              partyId: election.partyId,
              partyName: resolvePartyName(election.partyId, electionCountryId),
              characterParty: character.party,
              characterPartyName: resolvePartyName(character.party, charCountryId),
            });
          }
        }
      }
    }

    return NextResponse.json({
      status: orphaned.length === 0 ? "ok" : "needs_fix",
      issueCount: orphaned.length,
      candidates: orphaned.slice(0, 50),
      message:
        orphaned.length === 0
          ? "All party election candidates are members of the correct party"
          : `Found ${orphaned.length} candidate(s) who left their party but remain in elections`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/party-leadership-elections
 * Withdraw candidates from party elections who are no longer members of that party
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();
    let fixed = 0;

    // Build state → countryId lookup
    const allStates = await db
      .collection<State>("states")
      .find({})
      .project<{ _id: string; countryId: CountryId }>({ _id: 1, countryId: 1 })
      .toArray();
    const stateCountryMap = new Map(allStates.map((s) => [s._id, s.countryId]));
    const getCountryFromState = (stateId: string): CountryId =>
      stateCountryMap.get(stateId) ?? "US";

    // Get all parties for lookup - key by country:sequentialId
    const parties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
    const partyByCountryAndSeqId = new Map<string, PoliticalParty>();
    for (const p of parties) {
      partyByCountryAndSeqId.set(`${p.countryId}:${p.sequentialId}`, p);
    }

    // Helper to check if character's party matches election party
    // Handles cross-country mismatches and sequential ID comparisons
    const isPartyMismatch = (
      characterParty: string,
      characterCountryId: CountryId,
      electionPartyId: string,
      electionCountryId: CountryId
    ): boolean => {
      if (characterParty === "independent") return true;

      // Different countries = automatic mismatch (cross-country bug)
      if (characterCountryId !== electionCountryId) return true;

      // Same country - compare sequential IDs directly
      if (characterParty === electionPartyId) return false;

      // Fallback: look up full party objects to compare _id
      const charParty = partyByCountryAndSeqId.get(`${characterCountryId}:${characterParty}`);
      const elecParty = partyByCountryAndSeqId.get(`${electionCountryId}:${electionPartyId}`);

      if (charParty && elecParty) {
        return charParty._id.toString() !== elecParty._id.toString();
      }
      return true;
    };

    // 1. Fix state party elections
    const activeStateElections = await db
      .collection<StatePartyElection>("statePartyElections")
      .find({ status: "voting" })
      .toArray();

    for (const election of activeStateElections) {
      const countryId = getCountryFromState(election.stateId);
      const candidates = await db
        .collection<StatePartyCandidate>("statePartyCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      for (const candidate of candidates) {
        const character = await db
          .collection<Character>("characters")
          .findOne({ _id: candidate.characterId });

        if (character) {
          const charCountryId = (character.countryId ?? "US") as CountryId;
          if (isPartyMismatch(character.party, charCountryId, election.partyId, countryId)) {
            await db
              .collection<StatePartyCandidate>("statePartyCandidates")
              .updateOne(
                { _id: candidate._id },
                { $set: { status: "withdrawn", withdrawnAt: now } }
              );
            fixed++;
          }
        }
      }
    }

    // 2. Fix national party elections
    const activeNationalElections = await db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find({ status: "voting" })
      .toArray();

    for (const election of activeNationalElections) {
      const electionCountryId = election.countryId ?? "US";
      const candidates = await db
        .collection<NationalPartyCandidate>("nationalPartyCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      for (const candidate of candidates) {
        const character = await db
          .collection<Character>("characters")
          .findOne({ _id: candidate.characterId });

        if (character) {
          const charCountryId = (character.countryId ?? "US") as CountryId;
          if (
            isPartyMismatch(character.party, charCountryId, election.partyId, electionCountryId)
          ) {
            await db
              .collection<NationalPartyCandidate>("nationalPartyCandidates")
              .updateOne(
                { _id: candidate._id },
                { $set: { status: "withdrawn", withdrawnAt: now } }
              );
            fixed++;
          }
        }
      }
    }

    // 3. Fix national committee elections
    const activeCommitteeElections = await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .find({ status: "voting" })
      .toArray();

    for (const election of activeCommitteeElections) {
      const electionCountryId = election.countryId ?? "US";
      const candidates = await db
        .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray();

      for (const candidate of candidates) {
        const character = await db
          .collection<Character>("characters")
          .findOne({ _id: candidate.characterId });

        if (character) {
          const charCountryId = (character.countryId ?? "US") as CountryId;
          if (
            isPartyMismatch(character.party, charCountryId, election.partyId, electionCountryId)
          ) {
            await db
              .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
              .updateOne(
                { _id: candidate._id },
                { $set: { status: "withdrawn", withdrawnAt: now } }
              );
            fixed++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message:
        fixed === 0
          ? "No candidates needed fixing"
          : `Withdrew ${fixed} candidate(s) who left their party from active elections`,
      fixed,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
