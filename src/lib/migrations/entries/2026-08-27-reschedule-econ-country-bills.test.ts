import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-27-reschedule-econ-country-bills";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("gameState");
  db.collection("bills");
  db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 439 });
  db.collectionMocks.bills.countDocuments.mockImplementation(async (filter) =>
    (filter as { status?: string }).status === "active" ? 2 : 0
  );
  db.collectionMocks.bills.updateMany.mockResolvedValue({ modifiedCount: 2 });
});

describe("2026-08-27 reschedule econ-country bills", () => {
  it("gives stranded active bills a fresh vote window while retaining votes", async () => {
    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    const [filter, update] = db.collectionMocks.bills.updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toMatchObject({ status: "active", lifecycleRepairIssue: { $ne: 996 } });
    expect(update.$set).toMatchObject({
      votingEndsOnTurn: 463,
      lifecycleRepairIssue: 996,
    });
    expect(JSON.stringify(update)).not.toContain('"votes"');
    expect(result.documentsUpdated).toBe(2);
  });

  it("reports matches without writing during a dry run", async () => {
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.bills.updateMany).not.toHaveBeenCalled();
    expect(result.documentsScanned).toBe(2);
    expect(result.documentsUpdated).toBe(0);
  });

  it("is idempotent through a per-bill repair marker", () => {
    expect(migration.idempotent).toBe(true);
  });
});
