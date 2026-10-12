vi.mock("@/lib/referendum/refundConversionConstruction", () => ({
  refundConversionConstruction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./reseedJoinedRegionElections", () => ({
  reseedJoinedRegionElections: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/country/mergeFxScale", () => ({
  loadFxScalePair: vi.fn().mockResolvedValue({ kind: "same-currency" }),
}));
vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  updateParliamentaryGovernmentSeats: vi.fn(),
  ensureParliamentaryGovernmentFormation: vi.fn(),
  unformGovernmentAndVacatePM: vi.fn(),
}));
vi.mock("@/lib/db/sessionDb", () => ({
  boundSession: () => undefined,
  unboundDb: (db: unknown) => db,
  withSessionDb: (_db: unknown, work: (db: unknown) => Promise<unknown>) => work(_db),
  afterCommit: (_db: unknown, effect: () => Promise<unknown>) => effect(),
}));
/**
 * End-to-end conservation test for the NI → Ireland transfer, run against a
 * compact in-memory store (the repo's MockDb doesn't persist, so the migration
 * helpers need a real store to assert post-state). `computeNationalMetrics` and
 * the history writes are stubbed — this test verifies the DATA migration
 * (topology + party + officials + region doc), not metric recompute.
 */
import { describe, it, expect, vi } from "vitest";
import { type Db } from "mongodb";

vi.mock("@/lib/nationalMetrics", () => ({
  computeNationalMetrics: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({
  recordCountryEvent: vi.fn().mockResolvedValue(undefined),
}));

import { transferRegion } from "./transferRegion";

import { makeStrictInMemoryStore } from "@/lib/test-utils/inMemoryStore";
type Doc = Record<string, unknown>;
function makeStore(seed: Record<string, Doc[]>): Db {
  return makeStrictInMemoryStore(seed).db;
}

function seedWorld() {
  return makeStore({
    states: [
      {
        _id: "NIR",
        countryId: "UK",
        regionType: "nation",
        parentRegionId: "NIR",
        population: 1_920_000,
        houseDistricts: 18,
        stateSenateSeats: 90,
      },
      {
        _id: "DUB",
        countryId: "IE",
        regionType: "region",
        population: 4_740_000,
        houseDistricts: 160,
        stateSenateSeats: 60,
      },
    ],
    // National parties are NOT migrated — they stay exactly as seeded.
    politicalParties: [
      { _id: "p-sf-uk", sequentialId: 20, countryId: "UK", name: "Sinn Féin" },
      { _id: "p-dup-uk", sequentialId: 21, countryId: "UK", name: "Democratic Unionist Party" },
      { _id: "p-sf-ie", sequentialId: 7, countryId: "IE", name: "Sinn Féin" },
    ],
    statePartyOrg: [
      { _id: "NIR_20", countryId: "UK", stateId: "NIR", partyId: "20" },
      { _id: "NIR_21", countryId: "UK", stateId: "NIR", partyId: "21" },
    ],
    partyBudget: [{ _id: "pb1", countryId: "UK", stateId: "NIR", partyId: "20" }],
    electedOfficials: [
      { _id: "mp1", countryId: "UK", officeType: "commons", state: "NIR", party: "20" },
      { _id: "cllr1", countryId: "UK", officeType: "regionalCouncil", state: "NIR", party: "21" },
    ],
    seats: [{ _id: "UK-commons-NIR-1", countryId: "UK", state: "NIR" }],
    // A player resident (has userId) + an NPP politician who CEOs a NIR company.
    characters: [{ _id: "c1", countryId: "UK", homeState: "NIR", party: "20", userId: "u1" }],
    npps: [
      { _id: "npp1", countryId: "UK", homeState: "NIR", party: "21", currentOffice: "commons" },
    ],
    corporations: [
      { _id: "corp1", countryId: "UK", headquartersState: "NIR", ceoType: "npp", ceoId: "npp1" },
    ],
    coalitions: [],
  });
}

const TRANSFER = {
  regionId: "NIR",
  fromCountryId: "UK" as const,
  toCountryId: "IE" as const,
  province: "Ulster",
  relocateToRegionId: "LON",
  currentTurn: 300,
};

describe("transferRegion — NI → Ireland (evacuate) conservation", () => {
  it("evacuates the region's politics, keeps UK parties intact, and converts the region doc", async () => {
    const db = seedWorld();
    const res = await transferRegion(db, TRANSFER);
    expect(res.ok).toBe(true);

    const states = await db.collection("states").find({}).toArray();
    const nir = states.find((s: Record<string, unknown>) => s._id === "NIR")!;
    expect(nir.countryId).toBe("IE");
    expect(nir.regionType).toBe("region");
    expect(nir.region).toBe("Ulster");
    expect(nir.votingSystem).toBe("rcv");
    expect(nir.houseDistricts).toBe(65); // population-share Dáil seats
    expect(nir.parentRegionId).toBeUndefined();

    // Parties are UNTOUCHED — none relocate to Ireland.
    const parties = await db.collection("politicalParties").find({}).toArray();
    const sfUk = parties.find((p: Record<string, unknown>) => p._id === "p-sf-uk")!;
    expect(sfUk.countryId).toBe("UK");
    expect(sfUk.sequentialId).toBe(20);
    const dup = parties.find((p: Record<string, unknown>) => p._id === "p-dup-uk")!;
    expect(dup.countryId).toBe("UK");
    expect(dup.sequentialId).toBe(21);

    // The region's party orgs / officials / seats are all dissolved.
    expect(await db.collection("statePartyOrg").find({ stateId: "NIR" }).toArray()).toHaveLength(0);
    expect(await db.collection("partyBudget").find({ stateId: "NIR" }).toArray()).toHaveLength(0);
    expect(await db.collection("electedOfficials").find({}).toArray()).toEqual([
      expect.objectContaining({ countryId: "IE", officeType: "dail", state: "NIR" }),
    ]);
    expect(await db.collection("seats").find({}).toArray()).toHaveLength(0);

    // The NPP relocated to London (still UK), office dropped; its corp followed.
    const npp = (await db.collection("npps").find({}).toArray())[0] as Record<string, unknown>;
    expect(npp.homeState).toBe("LON");
    expect(npp.countryId).toBe("UK");
    expect(npp.currentOffice).toBeNull();
    const corp = (await db.collection("corporations").find({}).toArray())[0] as Record<
      string,
      unknown
    >;
    expect(corp.headquartersState).toBe("LON");
    expect(corp.countryId).toBe("UK");

    // The player resident went Independent and became an Irish citizen of NIR.
    const char = (await db.collection("characters").find({}).toArray())[0] as Record<
      string,
      unknown
    >;
    expect(char.countryId).toBe("IE");
    expect(char.homeState).toBe("NIR");
    expect(char.party).toBe("independent");
  });

  it("is idempotent on a second run", async () => {
    const db = seedWorld();
    await transferRegion(db, TRANSFER);
    const again = await transferRegion(db, { ...TRANSFER, currentTurn: 301 });
    expect(again).toEqual({ ok: true, skipped: "already-transferred" });
  });
});
