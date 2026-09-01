import { describe, it, expect } from "vitest";
import {
  PARTY_REF_COLLECTIONS,
  PARTY_OBJECTID_COLLECTIONS,
  PARTY_KEYED_MAP_COLLECTIONS,
  NON_PARTY_SENTINELS,
  buildPartyIdMap,
} from "./partyMigrationCollections";

describe("partyMigrationCollections", () => {
  it("covers every collection the live scan found holding a sequentialId party ref", () => {
    const names = PARTY_REF_COLLECTIONS.map((r) => `${r.collection}.${r.field}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "billWhips.partyId",
        "bills.sponsorParty",
        "cabinetMembers.party",
        "characters.party",
        "electedOfficials.party",
        "electionCandidates.party",
        "npps.party",
        "orgRegLedger.partyId",
        "partyPoliticalStrengthLedger.partyId",
        "statePartyOrg.partyId",
        "treasuryTransactions.partyId",
      ])
    );
    expect(names).toHaveLength(41);
  });

  it("covers the fields a live renumber found stale because they were missing", () => {
    // Every one of these was pointing at the wrong party after a German
    // reunification renumbered a country's own parties: the government named a
    // party that had become banned opposition, and the Landeslisten pointed at
    // the other side's bloc. Nothing threw, because a stale sequentialId is a
    // valid number that simply names somebody else.
    const names = PARTY_REF_COLLECTIONS.map((r) => `${r.collection}.${r.field}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "activityLog.details.party",
        "countryLeaderStates.governingPartyId",
        "countryState.rulingPartyId",
        "executiveEndorsements.candidatePartyId",
        "governmentFormations.governingPartyId",
        "governorAddresses.agendaEffect.partyId",
        "governorEndorsements.candidatePartyId",
        "governorLegislationQueue.targetPartyId",
        "landeslisten.partyId",
        "partyHistory.partyId",
        "partyMembershipEvents.newPartyId",
        "partyMembershipEvents.oldPartyId",
        "pmAppointmentVotes.nomineePartyId",
      ])
    );
  });

  it("scopes a one-doc-per-country collection by its own id, not by countryId", () => {
    // `governmentFormations` has no `countryId` field at all, so a migration that
    // assumed one matched nothing there and reported no error.
    const gov = PARTY_REF_COLLECTIONS.find(
      (r) => r.collection === "governmentFormations" && r.field === "governingPartyId"
    );
    expect(gov?.countryKey).toBe("_id");
    // Everything else keeps the default.
    expect(
      PARTY_REF_COLLECTIONS.find((r) => r.collection === "characters")?.countryKey
    ).toBeUndefined();
  });

  it("keeps a party-KEYED map out of the value-rewriting table", () => {
    // `$set` on a path rewrites a value; it cannot rename a key. Listing
    // `seatsByParty` beside the scalar fields would silently no-op.
    const scalar = PARTY_REF_COLLECTIONS.map((r) => `${r.collection}.${r.field}`);
    expect(scalar).not.toContain("governmentFormations.seatsByParty");
    expect(PARTY_KEYED_MAP_COLLECTIONS).toEqual([
      { collection: "governmentFormations", field: "seatsByParty", countryKey: "_id" },
    ]);
  });

  it("registers every field exactly once", () => {
    const all = [...PARTY_REF_COLLECTIONS, ...PARTY_KEYED_MAP_COLLECTIONS].map(
      (r) => `${r.collection}.${r.field}`
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps the ObjectId-keyed collection out of the sequentialId table", () => {
    const seq = PARTY_REF_COLLECTIONS.map((r) => r.collection);
    expect(seq).not.toContain("committeeProposals");
    expect(PARTY_OBJECTID_COLLECTIONS).toEqual([
      { collection: "committeeProposals", field: "partyId" },
    ]);
  });

  it("treats the pool sentinel and unaffiliated markers as non-parties", () => {
    expect(NON_PARTY_SENTINELS.has("__pool__")).toBe(true);
    expect(NON_PARTY_SENTINELS.has("independent")).toBe(true);
    expect(NON_PARTY_SENTINELS.has("")).toBe(true);
    expect(NON_PARTY_SENTINELS.has("1")).toBe(false);
  });

  it("builds a string-keyed old to new map", () => {
    expect(
      buildPartyIdMap([
        { oldSequentialId: 1, newSequentialId: 7 },
        { oldSequentialId: 5, newSequentialId: 11 },
      ])
    ).toEqual({ "1": "7", "5": "11" });
  });
});
