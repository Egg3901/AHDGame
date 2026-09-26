import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { seedHURegions } from "./seedHU";

function regionDb() {
  const bulkWrite = vi.fn().mockResolvedValue({});
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 0 });
  const db = {
    collection: vi.fn().mockReturnValue({ bulkWrite, deleteMany }),
  } as unknown as Db;
  return { db, bulkWrite, deleteMany };
}

describe("HU modern region seeder", () => {
  it("persists the six 2027 regions before the regional bootstrap barrier", async () => {
    const { db, bulkWrite } = regionDb();
    await seedHURegions(db, false, () => {}, "2027-default");
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const operations = bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { houseDistricts: number } } };
    }>;
    expect(operations).toHaveLength(6);
    expect(operations.reduce((sum, op) => sum + op.updateOne.update.$set.houseDistricts, 0)).toBe(
      199
    );
  });

  it("leaves the selected 1991 seed path untouched", async () => {
    const { db, bulkWrite, deleteMany } = regionDb();
    await seedHURegions(db, true, () => {}, "1991-default");
    expect(bulkWrite).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
