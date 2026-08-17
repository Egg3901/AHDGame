import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { seedUnions, SEED_DUES_PER_WORKER_ANNUAL } from "./seedUnions";
import { BASE_APPROVAL } from "@/lib/unions/unionDues";

function makeDb(
  countryIds: string[],
  opts: { worldUnions?: { _id: ObjectId; countryId: string; sectorType: string }[] } = {}
) {
  // Resolves like the real driver: `upsertedCount` is the number of ops that
  // inserted, which is what the seeder reports back.
  const bulkWrite = vi
    .fn()
    .mockImplementation((ops: unknown[]) =>
      Promise.resolve({ upsertedCount: ops.length, modifiedCount: 0, matchedCount: 0 })
    );
  const sectorBulkWrite = vi
    .fn()
    .mockImplementation((ops: unknown[]) => Promise.resolve({ modifiedCount: ops.length }));
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 0 });
  const distinct = vi.fn().mockResolvedValue(countryIds);
  const unionsFind = vi
    .fn()
    .mockReturnValue({ toArray: () => Promise.resolve(opts.worldUnions ?? []) });

  const db = {
    collection: (name: string) => {
      if (name === "states") return { distinct };
      if (name === "unions") return { bulkWrite, deleteMany, find: unionsFind };
      if (
        name === "unionEndorsements" ||
        name === "unionLeaderVotes" ||
        name === "unionOrganizers"
      ) {
        return { deleteMany };
      }
      if (name === "corporateSectors") return { bulkWrite: sectorBulkWrite };
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;

  return { db, bulkWrite, sectorBulkWrite, deleteMany, distinct, unionsFind };
}

describe("seedUnions", () => {
  it("upserts vacant unions for every country × sector, seeded at BASE_APPROVAL with no dues/services", async () => {
    const { db, bulkWrite, sectorBulkWrite } = makeDb(["US", "UK"]);
    const logs: string[] = [];

    const inserted = await seedUnions(db, (msg) => logs.push(msg), "2019-default", false);

    expect(inserted).toBe(34); // 2 countries × 17 sector types
    // All 34 in a single round trip, not 34 of them.
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(34);
    expect(bulkWrite.mock.calls[0][1]).toEqual({ ordered: true });
    const { filter, update } = ops[0].updateOne;
    expect(filter).toMatchObject({ foundedByCharacterId: { $exists: false } });
    expect(update.$setOnInsert.ownerId).toBeNull();
    expect(update.$setOnInsert.name).toBeTruthy();
    expect(update.$setOnInsert.approval).toBe(BASE_APPROVAL);
    expect(update.$setOnInsert.duesPerWorkerAnnual).toBe(SEED_DUES_PER_WORKER_ANNUAL);
    expect(update.$setOnInsert.activeServices).toEqual([]);
    expect(update.$setOnInsert).not.toHaveProperty("membershipPressure");
    expect(logs[0]).toMatch(/Seeded unions/);
    // No world unions were found on read-back (the mock's default find() is
    // empty), so there is nothing to represent yet.
    expect(sectorBulkWrite).not.toHaveBeenCalled();
  });

  it("wipes unions and endorsements when reset=true", async () => {
    const { db, deleteMany } = makeDb(["US"]);

    await seedUnions(db, () => {}, "2019-default", true);

    expect(deleteMany).toHaveBeenCalledTimes(4);
  });

  it("hands each world-seeded union representation of its own (countryId, sectorType) sectors that nobody holds yet", async () => {
    const usFinanceUnionId = new ObjectId();
    const { db, sectorBulkWrite } = makeDb(["US"], {
      worldUnions: [{ _id: usFinanceUnionId, countryId: "US", sectorType: "financial" }],
    });

    await seedUnions(db, () => {}, "2019-default", false);

    expect(sectorBulkWrite).toHaveBeenCalledTimes(1);
    const sectorOps = sectorBulkWrite.mock.calls[0][0];
    // One updateMany per (countryId, sectorType) pair that resolved to a
    // world-seeded union, here, only the one the mock's find() returned.
    expect(sectorOps).toHaveLength(1);
    const { filter, update } = sectorOps[0].updateMany;
    expect(filter).toMatchObject({
      countryId: "US",
      sectorType: "financial",
      representingUnionId: null,
    });
    expect(update.$set.representingUnionId).toStrictEqual(usFinanceUnionId);
  });
});
