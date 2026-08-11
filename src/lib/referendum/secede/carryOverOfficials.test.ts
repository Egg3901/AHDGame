import { describe, it, expect } from "vitest";
import { makeInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { carryOverOfficials } from "./carryOverOfficials";

function seedWorld() {
  return makeInMemoryStore({
    electedOfficials: [
      {
        _id: "mp1",
        countryId: "UK",
        officeType: "commons",
        state: "SCO",
        party: "20",
        characterId: "x1",
      },
      { _id: "mp2", countryId: "UK", officeType: "commons", state: "SCO", party: "22" }, // non-major
      { _id: "mp3", countryId: "UK", officeType: "commons", state: "ENG", party: "21" }, // rump-UK
      {
        _id: "fm",
        countryId: "UK",
        officeType: "governor",
        state: "SCO",
        party: "20",
        characterId: "fmChar",
      },
    ],
  });
}

describe("carryOverOfficials", () => {
  it("turns region MPs into new-chamber members with remapped party", async () => {
    const { db, cols } = seedWorld();
    const res = await carryOverOfficials(db, "SCO", "UK", "SCO", { 20: 1, 21: 2 });

    expect(res.msps).toBe(2);
    const mp1 = cols.electedOfficials.find((o) => o._id === "mp1")!;
    expect(mp1).toMatchObject({ countryId: "SCO", officeType: "holyrood", party: "1" });
    const mp2 = cols.electedOfficials.find((o) => o._id === "mp2")!;
    expect(mp2).toMatchObject({ countryId: "SCO", officeType: "holyrood", party: "independent" });
  });

  it("leaves rump-UK MPs untouched", async () => {
    const { db, cols } = seedWorld();
    await carryOverOfficials(db, "SCO", "UK", "SCO", { 20: 1, 21: 2 });
    const mp3 = cols.electedOfficials.find((o) => o._id === "mp3")!;
    expect(mp3).toMatchObject({ countryId: "UK", officeType: "commons", state: "ENG" });
  });

  it("promotes the devolved FM to head of government", async () => {
    const { db, cols } = seedWorld();
    const res = await carryOverOfficials(db, "SCO", "UK", "SCO", { 20: 1, 21: 2 });

    expect(res.headOfGov).toBe(1);
    const fm = cols.electedOfficials.find((o) => o._id === "fm")!;
    expect(fm).toMatchObject({ countryId: "SCO", officeType: "firstMinister", party: "1" });
    // Forms a government under the CANONICAL fields the parliamentary system
    // reads (pmCharacterId + "formed" status), not the dead headOfGov field.
    expect(cols.governmentFormations[0]).toMatchObject({
      _id: "SCO",
      countryId: "SCO",
      status: "formed",
      pmCharacterId: "fmChar",
      governingPartyId: "1",
    });
    expect(cols.governmentFormations[0].headOfGovernmentCharacterId).toBeUndefined();
  });

  it("is a no-op when re-run (region MPs already carried)", async () => {
    const { db } = seedWorld();
    await carryOverOfficials(db, "SCO", "UK", "SCO", { 20: 1, 21: 2 });
    const res2 = await carryOverOfficials(db, "SCO", "UK", "SCO", { 20: 1, 21: 2 });
    expect(res2).toEqual({ msps: 0, headOfGov: 0 });
  });
});
