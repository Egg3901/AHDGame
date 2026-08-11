import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  shouldRunCensus,
  computeSeatDeltas,
  buildCensusContent,
  US_HOUSE_TOTAL_SEATS,
} from "./census";

vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));

describe("shouldRunCensus (decennial, Week-1-of-year-ending-in-0)", () => {
  it("fires on a year ending in 0 not yet censused", () => {
    expect(shouldRunCensus(2020, undefined)).toBe(true);
    expect(shouldRunCensus(2000, 1990)).toBe(true); // 1991-preset path
  });
  it("does not re-fire within the same census year", () => {
    expect(shouldRunCensus(2020, 2020)).toBe(false);
  });
  it("does not fire on non-decennial years", () => {
    expect(shouldRunCensus(2021, undefined)).toBe(false);
    expect(shouldRunCensus(2019, undefined)).toBe(false); // a preset start year
  });
  it("guards non-finite years", () => {
    expect(shouldRunCensus(NaN, undefined)).toBe(false);
  });
});

describe("computeSeatDeltas", () => {
  it("returns only changed states, gains first", () => {
    const deltas = computeSeatDeltas({ TX: 38, NY: 26, CA: 52 }, { TX: 40, NY: 25, CA: 52 });
    expect(deltas).toEqual([
      { state: "TX", from: 38, to: 40, delta: 2 },
      { state: "NY", from: 26, to: 25, delta: -1 },
    ]);
  });
});

describe("buildCensusContent", () => {
  it("names the seat changes", () => {
    const content = buildCensusContent(2020, [
      { state: "TX", from: 38, to: 40, delta: 2 },
      { state: "NY", from: 26, to: 25, delta: -1 },
    ]);
    expect(content).toContain("2020 Census");
    expect(content).toContain("TX +2");
    expect(content).toContain("NY -1");
  });
  it("notes when apportionment is unchanged", () => {
    expect(buildCensusContent(2020, [])).toContain("unchanged");
  });
});

describe("runCensus (phase)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function setup(currentYear: number, lastCensusYear?: number) {
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "current", currentYear, lastCensusYear });
    db.collection("states");
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", population: 39_000_000, houseDistricts: 50 },
        { _id: "TX", population: 31_000_000, houseDistricts: 38 },
        { _id: "WY", population: 580_000, houseDistricts: 1 },
        { _id: "DC", population: 700_000 }, // no houseDistricts → excluded
      ]),
    });
  }

  it("reapportions, writes houseDistricts (sum 435), stamps lastCensusYear, posts news", async () => {
    setup(2020, undefined);
    const { runCensus } = await import("./census");
    const { createSystemNewsPost } = await import("@/lib/news");

    const result = await runCensus(db as unknown as Db, 96);

    expect(result.ran).toBe(true);
    expect(result.year).toBe(2020);
    const seatOps = db.collectionMocks.states!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { houseDistricts: number } } };
    }>;
    const sum = seatOps.reduce((s, o) => s + o.updateOne.update.$set.houseDistricts, 0);
    expect(sum).toBe(US_HOUSE_TOTAL_SEATS); // 435 conserved
    expect(db.collectionMocks.gameState!.updateOne).toHaveBeenCalled();
    // P1d-3: the per-region seat-change summary is persisted for the UI notice.
    const gsSet = (
      db.collectionMocks.gameState!.updateOne.mock.calls[0][1] as {
        $set: { lastCensusYear: number; lastCensus?: { year: number; deltas: unknown[] } };
      }
    ).$set;
    expect(gsSet.lastCensusYear).toBe(2020);
    expect(gsSet.lastCensus?.year).toBe(2020);
    expect(Array.isArray(gsSet.lastCensus?.deltas)).toBe(true);
    expect(createSystemNewsPost).toHaveBeenCalledTimes(1);
  });

  it("no-ops on a non-decennial year (no writes, no news)", async () => {
    setup(2021, undefined);
    const { runCensus } = await import("./census");
    const { createSystemNewsPost } = await import("@/lib/news");

    const result = await runCensus(db as unknown as Db, 100);

    expect(result.ran).toBe(false);
    expect(db.collectionMocks.states!.bulkWrite).not.toHaveBeenCalled();
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("no-ops when this census year already ran", async () => {
    setup(2020, 2020);
    const { runCensus } = await import("./census");
    expect((await runCensus(db as unknown as Db, 96)).ran).toBe(false);
  });
});
