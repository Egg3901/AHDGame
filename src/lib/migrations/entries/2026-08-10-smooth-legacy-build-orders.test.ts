import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-10-smooth-legacy-build-orders";

const CURRENT_TURN = 21;

let db: MockDb;

function wire(currentTurn: number | undefined, matched: number, modified: number) {
  db = createMockDb();
  db.collection("gameState");
  db.collection("corporateSectors");
  db.collectionMocks.gameState.findOne.mockResolvedValue(
    currentTurn === undefined ? null : { _id: "current", currentTurn }
  );
  db.collectionMocks.corporateSectors.countDocuments.mockResolvedValue(matched);
  db.collectionMocks.corporateSectors.updateMany.mockResolvedValue({ modifiedCount: modified });
}

describe("migration: smooth-legacy-build-orders", () => {
  beforeEach(() => wire(CURRENT_TURN, 5, 5));

  it("smooths only legacy, still-building orders and re-anchors startTurn to the current turn", async () => {
    const res = await migration.execute(db as unknown as Db, { dryRun: false });

    const call = db.collectionMocks.corporateSectors.updateMany.mock.calls[0];
    const [filter, update, options] = call as [
      Record<string, unknown>,
      Record<string, unknown>,
      { arrayFilters: Record<string, unknown>[] },
    ];

    // Only touches sectors that hold a non-smooth order still under construction.
    expect(filter).toEqual({
      buildQueue: { $elemMatch: { smooth: { $ne: true }, onlineTurn: { $gt: CURRENT_TURN } } },
    });
    // Sets smooth + re-anchors startTurn on the matched elements only.
    expect(update).toEqual({
      $set: {
        "buildQueue.$[o].smooth": true,
        "buildQueue.$[o].startTurn": CURRENT_TURN,
      },
    });
    expect(options.arrayFilters).toEqual([
      { "o.smooth": { $ne: true }, "o.onlineTurn": { $gt: CURRENT_TURN } },
    ]);
    // costPaidAnchor is never written — no money moves.
    expect(JSON.stringify(update)).not.toContain("costPaidAnchor");

    expect(res.documentsUpdated).toBe(5);
  });

  it("writes nothing on a dry run but still reports what it would touch", async () => {
    const res = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.corporateSectors.updateMany).not.toHaveBeenCalled();
    expect(res.documentsScanned).toBe(5);
  });

  it("refuses to run when the world has no readable currentTurn", async () => {
    wire(undefined, 0, 0);
    await expect(migration.execute(db as unknown as Db, { dryRun: false })).rejects.toThrow(
      /currentTurn/
    );
    expect(db.collectionMocks.corporateSectors.updateMany).not.toHaveBeenCalled();
  });

  it("is registered as idempotent", () => {
    expect(migration.idempotent).toBe(true);
    expect(migration.id).toBe("2026-08-10-smooth-legacy-build-orders");
  });
});
