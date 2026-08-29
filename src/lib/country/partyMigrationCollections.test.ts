import { describe, it, expect } from "vitest";
import {
  PARTY_REF_COLLECTIONS,
  PARTY_OBJECTID_COLLECTIONS,
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
    expect(names).toHaveLength(28);
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
