import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-03-retire-orphan-sovereign-float";

let db: MockDb;

function bond(overrides: Record<string, unknown>) {
  return {
    _id: new ObjectId(),
    issuerType: "sovereign",
    countryId: "FR",
    matured: false,
    defaulted: false,
    holders: [],
    ...overrides,
  };
}

beforeEach(() => {
  db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentTurn: 583 });
  db.collection("bonds").bulkWrite.mockResolvedValue({ modifiedCount: 2 });
});

describe("retire orphan sovereign float", () => {
  it("retires newest float first until face matches principal and closes empty series", async () => {
    const older = bond({
      issuedAtTurn: 528,
      totalIssued: 4_000_000,
      publicFloat: 3_000,
      holders: [{ characterId: new ObjectId(), units: 1_000 }],
    });
    const newer = bond({ issuedAtTurn: 576, totalIssued: 2_000_000, publicFloat: 2_000 });
    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [older, newer] });
    db.collection("federalBudget").findOne.mockResolvedValue({
      _id: "FR",
      debt: { principal: 1_500_000 },
    });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    const ops = db.collectionMocks.bonds.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
    }>;
    // Excess 4.5M: the newer series loses all 2,000 units and closes; the
    // older loses 2,500 of its 3,000 and keeps its holder.
    expect(ops).toHaveLength(2);
    const newerOp = ops.find((op) => op.updateOne.filter._id === newer._id)!;
    expect(newerOp.updateOne.update.$set).toMatchObject({
      publicFloat: 0,
      totalIssued: 0,
      matured: true,
      redeemedAtTurn: 583,
    });
    const olderOp = ops.find((op) => op.updateOne.filter._id === older._id)!;
    expect(olderOp.updateOne.update.$set).toMatchObject({
      publicFloat: 500,
      totalIssued: 1_500_000,
    });
    expect(olderOp.updateOne.update.$set.matured).toBeUndefined();
    expect(result.documentsUpdated).toBe(2);
  });

  it("leaves countries whose bonds are within principal alone", async () => {
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        bond({ issuedAtTurn: 576, totalIssued: 1_000_000, publicFloat: 1_000 }),
      ],
    });
    db.collection("federalBudget").findOne.mockResolvedValue({
      _id: "FR",
      debt: { principal: 5_000_000 },
    });
    await migration.execute(db as unknown as Db, { dryRun: false });
    expect(db.collectionMocks.bonds.bulkWrite).not.toHaveBeenCalled();
  });

  it("writes nothing in dry run", async () => {
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        bond({ issuedAtTurn: 576, totalIssued: 1_000_000, publicFloat: 1_000 }),
      ],
    });
    db.collection("federalBudget").findOne.mockResolvedValue({ _id: "FR", debt: { principal: 0 } });
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.bonds.bulkWrite).not.toHaveBeenCalled();
    expect(result.notes?.[0]).toContain("would retire float on 1");
  });
});
