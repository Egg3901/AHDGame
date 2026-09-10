import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
});

describe("seedDERegions, 2027-default wiring", () => {
  it("writes the 2027 bundle (16 Länder) for 2027-default", async () => {
    const { seedDERegions } = await import("@/lib/admin/seed/seedDE");
    await seedDERegions(db as unknown as Db, false, () => {}, "2027-default");

    const ops = bulkOps(db.collectionMocks.states!.bulkWrite);
    const byId = new Map(
      ops.map(([filter, update]) => [
        (filter as { _id: string })._id,
        (update as { $set: Record<string, unknown> }).$set,
      ])
    );
    expect(byId.size).toBe(16);
    // 2027-authored values, distinct from the 2023 bundle.
    expect(byId.get("BE")!.population).toBe(3_910_000);
    expect(byId.get("BW")!.gdp).toBe(646_000);
    const wahlkreise = [...byId.values()].reduce((s, set) => s + (set.houseDistricts as number), 0);
    expect(wahlkreise).toBe(299);
  });

  it("still writes the 2023 bundle for 2023-default", async () => {
    const { seedDERegions } = await import("@/lib/admin/seed/seedDE");
    await seedDERegions(db as unknown as Db, false, () => {}, "2023-default");

    const ops = bulkOps(db.collectionMocks.states!.bulkWrite);
    const byId = new Map(
      ops.map(([filter, update]) => [
        (filter as { _id: string })._id,
        (update as { $set: Record<string, unknown> }).$set,
      ])
    );
    expect(byId.size).toBe(16);
    expect(byId.get("BE")!.population).toBe(3_850_000);
  });
});
