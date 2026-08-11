import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

vi.mock("@/lib/military/conscriptionLaw", () => ({
  resolveConscriptionStanceFor: vi.fn(),
}));

const { resolveConscriptionStanceFor } = await import("@/lib/military/conscriptionLaw");
const { seedNationalManpower } = await import("./seedNationalManpower");

const COUNTRY_COUNT = Object.keys(COUNTRY_CONFIGS).length;

describe("seedNationalManpower", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("nationalManpower");
    db.collection("states");
    db.collectionMocks.nationalManpower.distinct.mockResolvedValue([]);
    db.collectionMocks.nationalManpower.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 1,
    });
    // 100M population x 0.02 cap x 1.0 stance = 2,000,000 ceiling -> 500,000 at 25%.
    db.collectionMocks.states.aggregate.mockReturnValue({
      toArray: async () => [
        { _id: "US", population: 100_000_000 },
        { _id: "DD", population: 18_400_000 },
      ],
    });
    vi.mocked(resolveConscriptionStanceFor).mockResolvedValue({
      id: "selective",
      label: "Selective Service",
      poolMult: 1,
      conscriptAllowed: true,
    });
  });

  it("seeds every country that has population, including those with no army", async () => {
    const result = await seedNationalManpower(db as unknown as Db);
    // The fixture gives only US and DD regions; the rest are deferred, not zeroed.
    expect(result.seeded).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.deferred).toBe(COUNTRY_COUNT - 2);
    expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledTimes(2);
  });

  it("starts a nation at 25% of its ceiling, not the full ceiling", async () => {
    await seedNationalManpower(db as unknown as Db);
    const us = db.collectionMocks.nationalManpower.updateOne.mock.calls.find(
      (c) => c[0].countryId === "US"
    )!;
    // ceiling = 100M x 0.02 x 1.0 = 2,000,000; a quarter of that is 500,000.
    expect(us[1].$setOnInsert.pool).toBe(500_000);
  });

  it("writes mode explicitly — a doc without it breaks applyReinforcement's off branch", async () => {
    await seedNationalManpower(db as unknown as Db);
    for (const call of db.collectionMocks.nationalManpower.updateOne.mock.calls) {
      expect(call[1].$setOnInsert.mode).toBe("trained");
    }
  });

  it("scales with the conscription stance actually in force", async () => {
    vi.mocked(resolveConscriptionStanceFor).mockResolvedValue({
      id: "universal",
      label: "Universal Conscription",
      poolMult: 2,
      conscriptAllowed: true,
    });
    await seedNationalManpower(db as unknown as Db);
    const us = db.collectionMocks.nationalManpower.updateOne.mock.calls.find(
      (c) => c[0].countryId === "US"
    )!;
    expect(us[1].$setOnInsert.pool).toBe(1_000_000);
  });

  it("never overwrites a country that already has a pool", async () => {
    db.collectionMocks.nationalManpower.distinct.mockResolvedValue(["US", "DD"]);
    const result = await seedNationalManpower(db as unknown as Db);
    expect(result.skipped).toBe(2);
    expect(result.seeded).toBe(0);
    expect(db.collectionMocks.nationalManpower.updateOne).not.toHaveBeenCalled();
  });

  it("uses $setOnInsert so a concurrent seed cannot reset a live pool", async () => {
    await seedNationalManpower(db as unknown as Db);
    for (const call of db.collectionMocks.nationalManpower.updateOne.mock.calls) {
      expect(call[1].$set).toBeUndefined();
      expect(call[2]).toEqual({ upsert: true });
    }
  });

  // THE trap this seeder has to avoid. runCoreSeed seeds only US states, so an
  // early pass sees 27 countries with no population. Writing pool:0 there would
  // make the later pass skip them as "already seeded" and every non-US nation
  // would start at 0 forever.
  it("defers a country with no regions instead of writing a zero it would never revisit", async () => {
    await seedNationalManpower(db as unknown as Db);
    const touched = db.collectionMocks.nationalManpower.updateOne.mock.calls.map(
      (c) => c[0].countryId
    );
    expect(touched.sort()).toEqual(["DD", "US"]);
    expect(touched).not.toContain("PL");
  });

  it("fills a deferred country once its regions exist", async () => {
    // Second pass, after the per-country region seeders have run.
    db.collectionMocks.states.aggregate.mockReturnValue({
      toArray: async () => [{ _id: "PL", population: 25_000_000 }],
    });
    await seedNationalManpower(db as unknown as Db);
    const pl = db.collectionMocks.nationalManpower.updateOne.mock.calls.find(
      (c) => c[0].countryId === "PL"
    )!;
    expect(pl[1].$setOnInsert.pool).toBe(125_000);
  });

  // Guards the ordering constraint: population comes from `states`, so running
  // this before the states seed would silently write zeros for every country.
  it("derives a non-zero pool whenever population exists", async () => {
    await seedNationalManpower(db as unknown as Db);
    const dd = db.collectionMocks.nationalManpower.updateOne.mock.calls.find(
      (c) => c[0].countryId === "DD"
    )!;
    expect(dd[1].$setOnInsert.pool).toBeGreaterThan(0);
    expect(dd[1].$setOnInsert.pool).toBe(92_000);
  });
});
