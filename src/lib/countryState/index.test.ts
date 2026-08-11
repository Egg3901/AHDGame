import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCountryState, updateCountryState } from "@/lib/countryState";
import { clearCountryStateCacheForDb } from "@/lib/countryState/cache";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";

describe("getCountryState", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("countryState");
    clearCountryStateCacheForDb(db as unknown as Db);
  });

  it("returns the seeded document for CN", async () => {
    const seed = seedCountryStateFromConfig("CN", new Date());
    db.collectionMocks.countryState.findOne.mockResolvedValueOnce(seed);

    const state = await getCountryState(db as unknown as Db, "CN");

    expect(state.governmentType).toBe("onePartyState");
    expect(state.countryId).toBe("CN");
  });

  it("caches subsequent calls within the same Db", async () => {
    const seed = seedCountryStateFromConfig("CN", new Date());
    db.collectionMocks.countryState.findOne.mockResolvedValueOnce(seed);

    await getCountryState(db as unknown as Db, "CN");
    await getCountryState(db as unknown as Db, "CN");
    await getCountryState(db as unknown as Db, "CN");

    expect(db.collectionMocks.countryState.findOne).toHaveBeenCalledTimes(1);
  });

  it("self-heals from COUNTRY_CONFIGS when the doc is missing", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValueOnce(null);

    const state = await getCountryState(db as unknown as Db, "CN");

    // Seeded shape from COUNTRY_CONFIGS.CN
    expect(state.governmentType).toBe("onePartyState");
    expect(state.countryId).toBe("CN");
    // Best-effort persist attempted
    expect(db.collectionMocks.countryState.insertOne).toHaveBeenCalled();
  });

  it("throws when the countryId is not a known COUNTRY_CONFIGS entry", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValueOnce(null);

    await expect(
      // @ts-expect-error — intentionally invalid CountryId
      getCountryState(db as unknown as Db, "XX")
    ).rejects.toThrow(/unknown countryId "XX"/i);
  });
});

describe("updateCountryState", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("countryState");
    clearCountryStateCacheForDb(db as unknown as Db);
  });

  it("applies a partial patch and stamps updatedAt", async () => {
    const seed = seedCountryStateFromConfig("CN", new Date("2026-05-28T00:00:00Z"));
    db.collectionMocks.countryState.findOne.mockResolvedValue(seed);
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValueOnce({
      ...seed,
      governmentType: "parliamentaryRepublic",
      updatedAt: new Date("2026-05-29T00:00:00Z"),
    });

    const next = await updateCountryState(db as unknown as Db, "CN", {
      governmentType: "parliamentaryRepublic",
    });

    expect(next.governmentType).toBe("parliamentaryRepublic");
    const updateCall = db.collectionMocks.countryState.findOneAndUpdate.mock.calls[0];
    const setOp = (updateCall[1] as { $set: Record<string, unknown> }).$set;
    expect(setOp).toMatchObject({ governmentType: "parliamentaryRepublic" });
    expect((setOp as { updatedAt: Date }).updatedAt).toBeInstanceOf(Date);
  });

  it("invalidates the cache so subsequent reads re-fetch", async () => {
    const seed = seedCountryStateFromConfig("CN", new Date());
    db.collectionMocks.countryState.findOne.mockResolvedValue(seed);
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValueOnce({
      ...seed,
      governmentType: "parliamentaryRepublic",
    });

    await getCountryState(db as unknown as Db, "CN");
    expect(db.collectionMocks.countryState.findOne).toHaveBeenCalledTimes(1);

    await updateCountryState(db as unknown as Db, "CN", {
      governmentType: "parliamentaryRepublic",
    });

    await getCountryState(db as unknown as Db, "CN");
    expect(db.collectionMocks.countryState.findOne).toHaveBeenCalledTimes(2);
  });
});
