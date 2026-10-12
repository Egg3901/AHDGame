vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  ensureParliamentaryGovernmentFormation: vi.fn(),
  unformGovernmentAndVacatePM: vi.fn(),
}));
import { describe, it, expect, vi } from "vitest";
import { makeStrictInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import { carryOverOfficials } from "./carryOverOfficials";

function seedWorld() {
  return makeStrictInMemoryStore({
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
  it("unseats region MPs for the new country's elections", async () => {
    const { db, cols } = seedWorld();
    const res = await carryOverOfficials(db, "SCO", "UK", "SCO", { 20: 1 });
    expect(res.msps).toBe(0);
    expect(cols.electedOfficials.some((row) => row._id === "mp1" || row._id === "mp2")).toBe(false);
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
    expect(fm).toMatchObject({
      countryId: "SCO",
      officeType: "firstMinister",
      party: "1",
      state: "LOT",
    });
    // Forms a government under the CANONICAL fields the parliamentary system
    // reads (pmCharacterId + "formed" status), not the dead headOfGov field.
    expect(cols.governmentFormations[0]).toMatchObject({
      _id: "SCO",
      countryId: "SCO",
      status: "formed",
      formationType: "minority",
      isMinority: true,
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
