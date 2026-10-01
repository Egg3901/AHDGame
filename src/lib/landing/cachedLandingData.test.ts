import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findOne = vi.fn();
const aggregateToArray = vi.fn();
const countryStateToArray = vi.fn();
const listCrises = vi.fn();
const getEnabledCountryIdsFromDb = vi.fn();

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => {
      if (name === "characters") {
        return {
          aggregate: () => ({ toArray: aggregateToArray }),
        };
      }
      if (name === "countryState") {
        return {
          find: () => ({ toArray: countryStateToArray }),
        };
      }
      return { findOne };
    },
  })),
}));

vi.mock("@/lib/crises/queries/crisisQueries", () => ({
  listCrises: (...a: unknown[]) => listCrises(...a),
}));

vi.mock("@/lib/countryAccess", () => ({
  getEnabledCountryIdsFromDb: (...a: unknown[]) => getEnabledCountryIdsFromDb(...a),
}));

import { getCachedLandingData, invalidateLandingDataCache } from "./cachedLandingData";

describe("getCachedLandingData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invalidateLandingDataCache();
    findOne.mockReset();
    aggregateToArray.mockReset();
    countryStateToArray.mockReset();
    listCrises.mockReset();
    getEnabledCountryIdsFromDb.mockReset();

    findOne.mockResolvedValue({ seedYear: 1979 });
    listCrises.mockResolvedValue({ crises: [], currentTurn: 1, startingYear: 1979 });
    getEnabledCountryIdsFromDb.mockResolvedValue(["US", "UK"]);
    aggregateToArray.mockResolvedValue([
      { _id: "US", count: 12 },
      { _id: "UK", count: 3 },
    ]);
    countryStateToArray.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the world's current year, never earlier than its seed", async () => {
    findOne
      .mockResolvedValueOnce({ seedYear: 1991 })
      .mockResolvedValueOnce({ startingYear: 1991, currentYear: 1994 });
    const snapshot = await getCachedLandingData();
    expect(snapshot.seedYear).toBe(1991);
    expect(snapshot.currentYear).toBe(1994);
  });

  it("falls back to the seed year when the world has no current year", async () => {
    const snapshot = await getCachedLandingData();
    expect(snapshot.currentYear).toBe(snapshot.seedYear);
  });

  it("loads from Mongo once and serves the same snapshot within TTL", async () => {
    const a = await getCachedLandingData();
    const b = await getCachedLandingData();

    expect(a.playerCounts).toEqual({ US: 12, UK: 3 });
    expect(b).toBe(a);
    expect(aggregateToArray).toHaveBeenCalledTimes(1);
    expect(listCrises).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent misses onto one in-flight load", async () => {
    let resolveAgg!: (v: unknown) => void;
    aggregateToArray.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAgg = resolve;
        })
    );

    const p1 = getCachedLandingData();
    const p2 = getCachedLandingData();
    // Flush microtasks so loadLandingData reaches the aggregate call.
    await Promise.resolve();
    await Promise.resolve();
    expect(typeof resolveAgg).toBe("function");
    resolveAgg([
      { _id: "US", count: 1 },
      { _id: "UK", count: 2 },
    ]);
    const [a, b] = await Promise.all([p1, p2]);

    expect(a).toBe(b);
    expect(aggregateToArray).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL elapses", async () => {
    await getCachedLandingData();
    expect(aggregateToArray).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_001);
    await getCachedLandingData();
    expect(aggregateToArray).toHaveBeenCalledTimes(2);
  });
});
