import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { Character, NPP, PoliticalParty, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

// Map old slug values to party names for migration
const SLUG_TO_NAME: Record<string, string> = {
  democrat: "Democratic",
  republican: "Republican",
  labour: "Labour",
  conservative: "Conservative",
  "liberal-democrat": "Liberal Democrats",
  liberaldemocrat: "Liberal Democrats",
  green: "Green",
  reform: "Reform UK",
  snp: "Scottish National Party",
  plaidcymru: "Plaid Cymru",
};

interface MismatchedMember {
  _id: string;
  name: string;
  type: "character" | "npp";
  homeState: string;
  memberCountry: CountryId;
  derivedCountry: CountryId;
  countryMismatch: boolean;
  currentPartyId: string;
  currentPartyName: string | null;
  currentPartyCountry: CountryId | null;
  suggestedPartyId: string | null;
  suggestedPartyName: string | null;
  issue: "cross_country_party" | "no_matching_party" | "party_id_mismatch";
}

// Initialized in each handler; maps stateId → countryId from DB
let stateCountryMap: Map<string, CountryId>;
function getCountryFromState(stateId: string): CountryId {
  return stateCountryMap.get(stateId) ?? "US";
}

/**
 * GET /api/admin/heal/party-membership
 * Diagnose characters and NPPs whose party country doesn't match their home state country
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Build state → countryId lookup for getCountryFromState
    const allStates = await db
      .collection<State>("states")
      .find({})
      .project<{ _id: string; countryId: CountryId }>({ _id: 1, countryId: 1 })
      .toArray();
    stateCountryMap = new Map(allStates.map((s) => [s._id, s.countryId]));

    const [characters, npps, parties] = await Promise.all([
      db
        .collection<Character>("characters")
        .find({ party: { $exists: true, $ne: "independent" } })
        .toArray(),
      db
        .collection<NPP>("npps")
        .find({ party: { $exists: true, $ne: "independent" } })
        .toArray(),
      db.collection<PoliticalParty>("politicalParties").find({}).toArray(),
    ]);

    // Build party lookup maps - key by country:sequentialId for uniqueness
    const partyByCountryAndSeqId = new Map<string, PoliticalParty>();
    const partyByNameAndCountry = new Map<string, PoliticalParty>();
    for (const p of parties) {
      partyByCountryAndSeqId.set(`${p.countryId}:${p.sequentialId}`, p);
      partyByNameAndCountry.set(`${p.countryId}:${p.name}`, p);
    }

    // Helper to find party - needs member's country to resolve sequential ID correctly
    const findParty = (partyValue: string, memberCountry: CountryId): PoliticalParty | null => {
      // Try sequential ID in member's country first
      const bySeqIdInCountry = partyByCountryAndSeqId.get(`${memberCountry}:${partyValue}`);
      if (bySeqIdInCountry) return bySeqIdInCountry;

      // Try sequential ID in other countries (to detect cross-country issues)
      for (const p of parties) {
        if (String(p.sequentialId) === partyValue) return p;
      }

      // Try slug-to-name mapping
      const partyName = SLUG_TO_NAME[partyValue.toLowerCase()];
      if (partyName) {
        for (const p of parties) {
          if (p.name === partyName) return p;
        }
      }

      return null;
    };

    // Helper to find suggested party by name in correct country
    const findSuggestedParty = (
      partyValue: string,
      currentParty: PoliticalParty | null,
      memberCountry: CountryId
    ): PoliticalParty | null => {
      if (currentParty) {
        return partyByNameAndCountry.get(`${memberCountry}:${currentParty.name}`) ?? null;
      }
      const partyName = SLUG_TO_NAME[partyValue.toLowerCase()];
      if (partyName) {
        return partyByNameAndCountry.get(`${memberCountry}:${partyName}`) ?? null;
      }
      return null;
    };

    const mismatched: MismatchedMember[] = [];

    // Check characters
    for (const char of characters) {
      if (!char.party || char.party === "independent") continue;

      // Use character's countryId directly (authoritative), derive from homeState as fallback
      const memberCountry = char.countryId ?? getCountryFromState(char.homeState);
      const derivedCountry = getCountryFromState(char.homeState);
      const countryMismatch = memberCountry !== derivedCountry;

      // First, check if party exists in member's country with correct sequentialId
      const partyInMemberCountry = partyByCountryAndSeqId.get(`${memberCountry}:${char.party}`);

      // Also find what party they actually have (might be in wrong country)
      const currentParty = findParty(char.party, memberCountry);

      // Issue 1: Party ID exists in member's country - check if it's correct
      if (partyInMemberCountry) {
        // Party exists in their country with this ID - this is correct, no fix needed
        continue;
      }

      // Issue 2: Party doesn't exist in member's country with this ID
      // Try to find what party they have and suggest the correct one
      const suggestedParty = findSuggestedParty(char.party, currentParty, memberCountry);

      let issue: "cross_country_party" | "no_matching_party" | "party_id_mismatch";
      if (currentParty && currentParty.countryId !== memberCountry) {
        issue = "cross_country_party";
      } else if (!currentParty) {
        issue = "no_matching_party";
      } else {
        issue = "party_id_mismatch";
      }

      mismatched.push({
        _id: char._id.toString(),
        name: char.name,
        type: "character",
        homeState: char.homeState,
        memberCountry,
        derivedCountry,
        countryMismatch,
        currentPartyId: char.party,
        currentPartyName: currentParty?.name ?? null,
        currentPartyCountry: currentParty?.countryId ?? null,
        suggestedPartyId: suggestedParty ? String(suggestedParty.sequentialId) : null,
        suggestedPartyName: suggestedParty?.name ?? null,
        issue,
      });
    }

    // Check NPPs
    for (const npp of npps) {
      if (!npp.party || npp.party === "independent") continue;

      // Use NPP's countryId directly (authoritative), derive from homeState as fallback
      const memberCountry =
        (npp as unknown as { countryId?: CountryId }).countryId ??
        getCountryFromState(npp.homeState);
      const derivedCountry = getCountryFromState(npp.homeState);
      const countryMismatch = memberCountry !== derivedCountry;

      // First, check if party exists in member's country with correct sequentialId
      const partyInMemberCountry = partyByCountryAndSeqId.get(`${memberCountry}:${npp.party}`);

      if (partyInMemberCountry) {
        // Party exists in their country with this ID - correct, no fix needed
        continue;
      }

      const currentParty = findParty(npp.party, memberCountry);
      const suggestedParty = findSuggestedParty(npp.party, currentParty, memberCountry);

      let issue: "cross_country_party" | "no_matching_party" | "party_id_mismatch";
      if (currentParty && currentParty.countryId !== memberCountry) {
        issue = "cross_country_party";
      } else if (!currentParty) {
        issue = "no_matching_party";
      } else {
        issue = "party_id_mismatch";
      }

      mismatched.push({
        _id: npp._id.toString(),
        name: npp.name,
        type: "npp",
        homeState: npp.homeState,
        memberCountry,
        derivedCountry,
        countryMismatch,
        currentPartyId: npp.party,
        currentPartyName: currentParty?.name ?? null,
        currentPartyCountry: currentParty?.countryId ?? null,
        suggestedPartyId: suggestedParty ? String(suggestedParty.sequentialId) : null,
        suggestedPartyName: suggestedParty?.name ?? null,
        issue,
      });
    }

    return NextResponse.json({
      status: mismatched.length === 0 ? "ok" : "needs_fix",
      issueCount: mismatched.length,
      records: mismatched.slice(0, 100),
      message:
        mismatched.length === 0
          ? "All party memberships are correctly assigned"
          : `Found ${mismatched.length} member(s) with cross-country party assignments`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/party-membership
 * Fix characters and NPPs by reassigning them to the correct party in their country
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Build state → countryId lookup for getCountryFromState
    const allStates2 = await db
      .collection<State>("states")
      .find({})
      .project<{ _id: string; countryId: CountryId }>({ _id: 1, countryId: 1 })
      .toArray();
    stateCountryMap = new Map(allStates2.map((s) => [s._id, s.countryId]));

    const [characters, npps, parties] = await Promise.all([
      db
        .collection<Character>("characters")
        .find({ party: { $exists: true, $ne: "independent" } })
        .toArray(),
      db
        .collection<NPP>("npps")
        .find({ party: { $exists: true, $ne: "independent" } })
        .toArray(),
      db.collection<PoliticalParty>("politicalParties").find({}).toArray(),
    ]);

    // Build party lookup maps - key by country:sequentialId for uniqueness
    const partyByCountryAndSeqId = new Map<string, PoliticalParty>();
    const partyByNameAndCountry = new Map<string, PoliticalParty>();
    for (const p of parties) {
      partyByCountryAndSeqId.set(`${p.countryId}:${p.sequentialId}`, p);
      partyByNameAndCountry.set(`${p.countryId}:${p.name}`, p);
    }

    // Helper to find party - needs member's country to resolve sequential ID correctly
    const findParty = (partyValue: string, memberCountry: CountryId): PoliticalParty | null => {
      // Try sequential ID in member's country first
      const bySeqIdInCountry = partyByCountryAndSeqId.get(`${memberCountry}:${partyValue}`);
      if (bySeqIdInCountry) return bySeqIdInCountry;

      // Try sequential ID in other countries (to detect cross-country issues)
      for (const p of parties) {
        if (String(p.sequentialId) === partyValue) return p;
      }

      // Try slug-to-name mapping
      const partyName = SLUG_TO_NAME[partyValue.toLowerCase()];
      if (partyName) {
        for (const p of parties) {
          if (p.name === partyName) return p;
        }
      }

      return null;
    };

    // Helper to find suggested party by name in correct country
    const findSuggestedParty = (
      partyValue: string,
      currentParty: PoliticalParty | null,
      memberCountry: CountryId
    ): PoliticalParty | null => {
      if (currentParty) {
        return partyByNameAndCountry.get(`${memberCountry}:${currentParty.name}`) ?? null;
      }
      const partyName = SLUG_TO_NAME[partyValue.toLowerCase()];
      if (partyName) {
        return partyByNameAndCountry.get(`${memberCountry}:${partyName}`) ?? null;
      }
      return null;
    };

    let charactersFixed = 0;
    let nppsFixed = 0;
    let charactersSetIndependent = 0;
    let nppsSetIndependent = 0;

    // Fix characters
    for (const char of characters) {
      if (!char.party || char.party === "independent") continue;

      // Use character's countryId directly (authoritative), derive from homeState as fallback
      const memberCountry = char.countryId ?? getCountryFromState(char.homeState);

      // Check if party already exists correctly in member's country
      const partyInMemberCountry = partyByCountryAndSeqId.get(`${memberCountry}:${char.party}`);
      if (partyInMemberCountry) {
        // Already correct - party ID matches a party in their country
        continue;
      }

      // Party doesn't exist in their country with this ID - find what they have and suggest fix
      const currentParty = findParty(char.party, memberCountry);
      const suggestedParty = findSuggestedParty(char.party, currentParty, memberCountry);

      if (suggestedParty) {
        await db
          .collection<Character>("characters")
          .updateOne(
            { _id: char._id },
            { $set: { party: String(suggestedParty.sequentialId), updatedAt: new Date() } }
          );
        charactersFixed++;
      } else {
        // No matching party found - set to independent
        await db
          .collection<Character>("characters")
          .updateOne({ _id: char._id }, { $set: { party: "independent", updatedAt: new Date() } });
        charactersSetIndependent++;
      }
    }

    // Fix NPPs
    for (const npp of npps) {
      if (!npp.party || npp.party === "independent") continue;

      // Use NPP's countryId directly (authoritative), derive from homeState as fallback
      const memberCountry =
        (npp as unknown as { countryId?: CountryId }).countryId ??
        getCountryFromState(npp.homeState);

      // Check if party already exists correctly in member's country
      const partyInMemberCountry = partyByCountryAndSeqId.get(`${memberCountry}:${npp.party}`);
      if (partyInMemberCountry) {
        // Already correct
        continue;
      }

      const currentParty = findParty(npp.party, memberCountry);
      const suggestedParty = findSuggestedParty(npp.party, currentParty, memberCountry);

      if (suggestedParty) {
        await db
          .collection<NPP>("npps")
          .updateOne(
            { _id: npp._id },
            { $set: { party: String(suggestedParty.sequentialId), updatedAt: new Date() } }
          );
        nppsFixed++;
      } else {
        await db
          .collection<NPP>("npps")
          .updateOne({ _id: npp._id }, { $set: { party: "independent", updatedAt: new Date() } });
        nppsSetIndependent++;
      }
    }

    const totalFixed = charactersFixed + nppsFixed;
    const totalIndependent = charactersSetIndependent + nppsSetIndependent;

    return NextResponse.json({
      success: true,
      message: `Fixed ${totalFixed} member(s) (${charactersFixed} characters, ${nppsFixed} NPPs). Set ${totalIndependent} to independent (no matching party found).`,
      charactersFixed,
      nppsFixed,
      charactersSetIndependent,
      nppsSetIndependent,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
