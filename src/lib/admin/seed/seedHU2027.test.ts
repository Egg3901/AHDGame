import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedHURegions, seedHUStatePartyOrg } from "./seedHU";

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

describe("HU modern party organization", () => {
  it("registers each of three parties in all six regions and clears stale rows on reset", async () => {
    const mock = createMockDb();
    mock.collection("politicalParties").find.mockReturnValue({
      toArray: async () => [{ sequentialId: 1 }, { sequentialId: 2 }, { sequentialId: 3 }],
    });
    await seedHUStatePartyOrg(mock as unknown as Db, true, () => {}, "2027-default");

    expect(mock.collectionMocks.statePartyOrg.deleteMany).toHaveBeenCalledWith({ countryId: "HU" });
    const updates = mock.collectionMocks.statePartyOrg.updateOne.mock.calls;
    expect(updates).toHaveLength(18);
    expect(new Set(updates.map(([filter]) => filter._id)).size).toBe(18);
    expect(new Set(updates.map(([, update]) => update.$set.stateId)).size).toBe(6);
    expect(new Set(updates.map(([, update]) => update.$set.partyId))).toEqual(
      new Set(["1", "2", "3"])
    );
    expect(updates.every(([, update]) => update.$set.hasPresence === true)).toBe(true);
  });

  it("leaves the selected 1991 party organization path untouched", async () => {
    const mock = createMockDb();
    await seedHUStatePartyOrg(mock as unknown as Db, true, () => {}, "1991-default");
    expect(mock.collectionMocks.statePartyOrg).toBeUndefined();
  });
});
