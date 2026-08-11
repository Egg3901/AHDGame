import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DEFAULT_STRATEGIC_SECTORS } from "@/lib/seeds/reference/strategicSectors";
import { seedStrategicSectors } from "./seedStrategicSectors";

const TOTAL_DESIGNATIONS = Object.values(DEFAULT_STRATEGIC_SECTORS).reduce(
  (sum, sectors) => sum + (sectors?.length ?? 0),
  0
);

describe("seedStrategicSectors", () => {
  let db: MockDb;
  const noop = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("seeds one upsert per (country, sector) default", async () => {
    const count = await seedStrategicSectors(db as unknown as Db, noop);

    expect(count).toBe(TOTAL_DESIGNATIONS);
    expect(db.collectionMocks.strategicSectorDesignations!.updateOne).toHaveBeenCalledTimes(
      TOTAL_DESIGNATIONS
    );
  });

  it("upserts with source 'seed' at turn 0", async () => {
    await seedStrategicSectors(db as unknown as Db, noop);

    const calls = db.collectionMocks.strategicSectorDesignations!.updateOne.mock.calls;
    for (const [filter, update, options] of calls) {
      expect(filter).toHaveProperty("countryId");
      expect(filter).toHaveProperty("sectorType");
      expect(update.$set.source).toBe("seed");
      expect(update.$set.designatedAtTurn).toBe(0);
      expect(options).toEqual({ upsert: true });
    }
  });

  it("is idempotent — re-running issues the same upserts (no duplicate inserts)", async () => {
    const first = await seedStrategicSectors(db as unknown as Db, noop);
    const second = await seedStrategicSectors(db as unknown as Db, noop);

    expect(second).toBe(first);
    // Every write is an upsert keyed on (countryId, sectorType), so a re-run
    // overwrites rather than inserting duplicates.
    const calls = db.collectionMocks.strategicSectorDesignations!.updateOne.mock.calls;
    for (const [, , options] of calls) {
      expect(options).toEqual({ upsert: true });
    }
  });
});
