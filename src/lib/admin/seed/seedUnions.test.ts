import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { seedUnions } from "./seedUnions";

function makeDb(countryIds: string[]) {
  // Resolves like the real driver: `upsertedCount` is the number of ops that
  // inserted, which is what the seeder reports back.
  const bulkWrite = vi
    .fn()
    .mockImplementation((ops: unknown[]) =>
      Promise.resolve({ upsertedCount: ops.length, modifiedCount: 0, matchedCount: 0 })
    );
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 0 });
  const distinct = vi.fn().mockResolvedValue(countryIds);

  const db = {
    collection: (name: string) => {
      if (name === "states") return { distinct };
      if (
        name === "unions" ||
        name === "unionEndorsements" ||
        name === "unionLeaderVotes" ||
        name === "unionOrganizers"
      ) {
        return { bulkWrite, deleteMany };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;

  return { db, bulkWrite, deleteMany, distinct };
}

describe("seedUnions", () => {
  it("upserts vacant unions for every country × sector", async () => {
    const { db, bulkWrite } = makeDb(["US", "UK"]);
    const logs: string[] = [];

    const inserted = await seedUnions(db, (msg) => logs.push(msg), "2019-default", false);

    expect(inserted).toBe(34); // 2 countries × 17 sector types
    // All 34 in a single round trip, not 34 of them.
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const ops = bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(34);
    expect(bulkWrite.mock.calls[0][1]).toEqual({ ordered: true });
    const { update } = ops[0].updateOne;
    expect(update.$setOnInsert.ownerId).toBeNull();
    expect(update.$setOnInsert.name).toBeTruthy();
    expect(logs[0]).toMatch(/Seeded unions/);
  });

  it("wipes unions and endorsements when reset=true", async () => {
    const { db, deleteMany } = makeDb(["US"]);

    await seedUnions(db, () => {}, "2019-default", true);

    expect(deleteMany).toHaveBeenCalledTimes(4);
  });
});
