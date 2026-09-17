import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
});

describe("seedUKRegions, 2027-default wiring", () => {
  it("writes the 2027 bundle (12 regions, 2024 boundaries) for 2027-default", async () => {
    const { seedUKRegions } = await import("@/lib/admin/seed/seedUK");
    await seedUKRegions(db as unknown as Db, false, () => {}, "2027-default");

    const ops = bulkOps(db.collectionMocks.states!.bulkWrite);
    const byId = new Map(
      ops.map(([filter, update]) => [
        (filter as { _id: string })._id,
        (update as { $set: Record<string, unknown> }).$set,
      ])
    );
    expect(byId.size).toBe(12);
    expect(byId.get("NEE")!.houseDistricts).toBe(27);
    expect(byId.get("NWE")!.houseDistricts).toBe(73);
    expect(byId.get("SCO")!.houseDistricts).toBe(57);
    expect(byId.get("WAL")!.houseDistricts).toBe(32);
    expect(byId.get("NIR")!.houseDistricts).toBe(18);
    const total = [...byId.values()].reduce((s, set) => s + (set.houseDistricts as number), 0);
    expect(total).toBe(650);
  });

  it("still writes the 2023 bundle for 2023-default", async () => {
    const { seedUKRegions } = await import("@/lib/admin/seed/seedUK");
    await seedUKRegions(db as unknown as Db, false, () => {}, "2023-default");

    const ops = bulkOps(db.collectionMocks.states!.bulkWrite);
    const byId = new Map(
      ops.map(([filter, update]) => [
        (filter as { _id: string })._id,
        (update as { $set: Record<string, unknown> }).$set,
      ])
    );
    expect(byId.get("NEE")!.houseDistricts).toBe(29);
    expect(byId.get("SCO")!.houseDistricts).toBe(59);
    expect(byId.get("WAL")!.houseDistricts).toBe(40);
  });
});
