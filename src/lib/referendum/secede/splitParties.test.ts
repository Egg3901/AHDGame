import { describe, it, expect } from "vitest";
import { makeInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { splitParties } from "./splitParties";

function seedWorld() {
  return makeInMemoryStore({
    politicalParties: [
      { _id: "snp", sequentialId: 20, countryId: "UK", name: "SNP", abbreviation: "SNP" },
      { _id: "lab", sequentialId: 21, countryId: "UK", name: "Labour", abbreviation: "LAB" },
      { _id: "con", sequentialId: 22, countryId: "UK", name: "Conservative", abbreviation: "CON" },
    ],
    electedOfficials: [
      { _id: "o1", countryId: "UK", officeType: "commons", state: "SCO", party: "20" }, // SNP, SCO only
      { _id: "o2", countryId: "UK", officeType: "commons", state: "SCO", party: "21" }, // LAB in SCO
      { _id: "o3", countryId: "UK", officeType: "commons", state: "ENG", party: "21" }, // LAB outside → UK-wide
      { _id: "o4", countryId: "UK", officeType: "commons", state: "SCO", party: "22" }, // CON, SCO only
    ],
    statePartyOrg: [
      { _id: "UK_SCO_20", countryId: "UK", stateId: "SCO", partyId: "20", organization: 60 },
      { _id: "UK_SCO_21", countryId: "UK", stateId: "SCO", partyId: "21", organization: 55 },
      { _id: "UK_SCO_22", countryId: "UK", stateId: "SCO", partyId: "22", organization: 40 },
      { _id: "UK_ENG_21", countryId: "UK", stateId: "ENG", partyId: "21", organization: 70 },
    ],
    // Members already re-homed to SCO by SP2b.
    characters: [
      { _id: "cA", countryId: "SCO", party: "20" },
      { _id: "cB", countryId: "SCO", party: "21" },
      { _id: "cC", countryId: "SCO", party: "22" },
      { _id: "cD", countryId: "SCO", party: "20" },
    ],
    partyBudget: [{ _id: "pb1", stateId: "SCO", partyId: "22" }],
  });
}

describe("splitParties", () => {
  it("transfers only the region-homed major; independentizes UK-wide majors and non-majors", async () => {
    const { db, cols } = seedWorld();
    const res = await splitParties(db, "SCO", "UK", "SCO");

    expect(res).toMatchObject({ wholesale: 1, independentized: 2 });
    expect(res.idMap).toEqual({ 20: 1 });

    // SNP moved wholesale: same doc, now SCO with id 1.
    const snp = cols.politicalParties.find((p) => p._id === "snp")!;
    expect(snp).toMatchObject({ countryId: "SCO", sequentialId: 1 });

    // LAB independentized: only the UK parent remains, no SCO successor doc.
    const labDocs = cols.politicalParties.filter((p) => p.abbreviation === "LAB");
    expect(labDocs).toHaveLength(1);
    expect(labDocs[0]).toMatchObject({ countryId: "UK", sequentialId: 21 });

    // CON stays a UK party (no SCO doc).
    expect(
      cols.politicalParties.some((p) => p.abbreviation === "CON" && p.countryId === "SCO")
    ).toBe(false);
  });

  it("re-parties members: the transferred major remapped, everyone else independent", async () => {
    const { db, cols } = seedWorld();
    await splitParties(db, "SCO", "UK", "SCO");
    const party = (id: string) => cols.characters.find((c) => c._id === id)!.party;
    expect(party("cA")).toBe("1"); // SNP → 1
    expect(party("cB")).toBe("independent"); // LAB (UK-wide) → independent
    expect(party("cC")).toBe("independent"); // CON → independent
    expect(party("cD")).toBe("1");
  });

  it("re-homes the transferred major's org to the capital; drops the rest + ledgers", async () => {
    const { db, cols } = seedWorld();
    await splitParties(db, "SCO", "UK", "SCO");
    // SNP org re-keyed onto the capital under SCO.
    expect(cols.statePartyOrg.some((g) => g._id === "SCO_LOT_1" && g.organization === 60)).toBe(
      true
    );
    // LAB + CON region orgs dropped (independentized); LAB's England org untouched.
    expect(cols.statePartyOrg.some((g) => g.stateId === "SCO" && g.partyId === "21")).toBe(false);
    expect(cols.statePartyOrg.some((g) => g.partyId === "22")).toBe(false);
    expect(cols.statePartyOrg.some((g) => g._id === "UK_ENG_21")).toBe(true);
    // Region party-ledger history dissolved.
    expect(cols.partyBudget).toHaveLength(0);
  });
});
