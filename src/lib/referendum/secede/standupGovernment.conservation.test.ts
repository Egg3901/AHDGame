/**
 * End-to-end SP2c conservation: splitParties → carryOverOfficials in sequence,
 * verifying the party-remap `idMap` flows correctly into the official carry-over
 * and that no official or member is orphaned.
 */
import { describe, it, expect } from "vitest";
import { makeInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { splitParties } from "./splitParties";
import { carryOverOfficials } from "./carryOverOfficials";

function seedWorld() {
  return makeInMemoryStore({
    politicalParties: [
      { _id: "snp", sequentialId: 20, countryId: "UK", name: "SNP", abbreviation: "SNP" },
      { _id: "lab", sequentialId: 21, countryId: "UK", name: "Labour", abbreviation: "LAB" },
      { _id: "con", sequentialId: 22, countryId: "UK", name: "Conservative", abbreviation: "CON" },
    ],
    electedOfficials: [
      {
        _id: "mpSNP",
        countryId: "UK",
        officeType: "commons",
        state: "SCO",
        party: "20",
        characterId: "x1",
      },
      {
        _id: "mpLAB",
        countryId: "UK",
        officeType: "commons",
        state: "SCO",
        party: "21",
        characterId: "x2",
      },
      {
        _id: "mpCON",
        countryId: "UK",
        officeType: "commons",
        state: "SCO",
        party: "22",
        characterId: "x3",
      },
      { _id: "mpEng", countryId: "UK", officeType: "commons", state: "ENG", party: "21" }, // gives LAB UK-wide presence
      {
        _id: "fm",
        countryId: "UK",
        officeType: "governor",
        state: "SCO",
        party: "20",
        characterId: "fmChar",
      },
    ],
    statePartyOrg: [
      { _id: "UK_SCO_20", countryId: "UK", stateId: "SCO", partyId: "20", organization: 60 },
      { _id: "UK_SCO_21", countryId: "UK", stateId: "SCO", partyId: "21", organization: 50 },
      { _id: "UK_SCO_22", countryId: "UK", stateId: "SCO", partyId: "22", organization: 30 },
      { _id: "UK_ENG_21", countryId: "UK", stateId: "ENG", partyId: "21", organization: 80 },
    ],
    characters: [
      { _id: "cA", countryId: "SCO", party: "20" },
      { _id: "cB", countryId: "SCO", party: "21" },
      { _id: "cC", countryId: "SCO", party: "22" },
    ],
  });
}

describe("SP2c government standup conservation", () => {
  it("splits parties then carries officials over with a consistent id map", async () => {
    const { db, cols } = seedWorld();

    const { idMap } = await splitParties(db, "SCO", "UK", "SCO");
    const carried = await carryOverOfficials(db, "SCO", "UK", "SCO", idMap);

    expect(idMap).toEqual({ 20: 1 });
    expect(carried).toEqual({ msps: 3, headOfGov: 1 });

    // Parties: SNP transfers wholesale; LAB independentized (UK parent stays),
    // CON not in SCO.
    expect(cols.politicalParties.find((p) => p._id === "snp")).toMatchObject({
      countryId: "SCO",
      sequentialId: 1,
    });
    expect(
      cols.politicalParties
        .filter((p) => p.abbreviation === "LAB")
        .map((p) => p.countryId)
        .sort()
    ).toEqual(["UK"]);
    expect(
      cols.politicalParties.some((p) => p.abbreviation === "CON" && p.countryId === "SCO")
    ).toBe(false);

    // Members re-partied consistently with the officials.
    const party = (id: string) => cols.characters.find((c) => c._id === id)!.party;
    expect([party("cA"), party("cB"), party("cC")]).toEqual(["1", "independent", "independent"]);

    // Every SCO MP carried to the new chamber; only SNP keeps a party (id 1),
    // LAB/CON members are independent.
    const o = (id: string) => cols.electedOfficials.find((x) => x._id === id)!;
    expect(o("mpSNP")).toMatchObject({ countryId: "SCO", officeType: "holyrood", party: "1" });
    expect(o("mpLAB")).toMatchObject({
      countryId: "SCO",
      officeType: "holyrood",
      party: "independent",
    });
    expect(o("mpCON")).toMatchObject({
      countryId: "SCO",
      officeType: "holyrood",
      party: "independent",
    });
    // FM → head of government.
    expect(o("fm")).toMatchObject({ countryId: "SCO", officeType: "firstMinister", party: "1" });
    expect(cols.governmentFormations[0]).toMatchObject({
      _id: "SCO",
      status: "formed",
      pmCharacterId: "fmChar",
      governingPartyId: "1",
    });

    // No SCO official orphaned on the old Westminster chamber; rump-UK untouched.
    expect(
      cols.electedOfficials.some((x) => x.countryId === "SCO" && x.officeType === "commons")
    ).toBe(false);
    expect(o("mpEng")).toMatchObject({ countryId: "UK", officeType: "commons", state: "ENG" });
  });

  it("is idempotent — re-running both steps changes nothing material", async () => {
    const { db, cols } = seedWorld();
    const { idMap } = await splitParties(db, "SCO", "UK", "SCO");
    await carryOverOfficials(db, "SCO", "UK", "SCO", idMap);
    const partiesAfter = cols.politicalParties.length;

    const { idMap: idMap2 } = await splitParties(db, "SCO", "UK", "SCO");
    const carried2 = await carryOverOfficials(db, "SCO", "UK", "SCO", idMap2);

    expect(cols.politicalParties.length).toBe(partiesAfter); // no duplicate party doc
    expect(carried2).toEqual({ msps: 0, headOfGov: 0 }); // nothing left on commons/governor
    // Re-run must NOT independentize already-carried members.
    const party = (id: string) => cols.characters.find((c) => c._id === id)!.party;
    expect([party("cA"), party("cB"), party("cC")]).toEqual(["1", "independent", "independent"]);
  });
});
