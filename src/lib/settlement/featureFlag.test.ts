import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

/**
 * `collectionMocks` is a PLAIN OBJECT, populated only when `db.collection(name)`
 * is first called — reading it before the code under test runs yields
 * undefined. Calling `db.collection` here creates and returns the mock, which
 * is what lets a test seed a return value up front.
 */
function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

describe("isSettlementCrisisEnabled", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("uses a preloaded projection without touching the database", async () => {
    const { isSettlementCrisisEnabled } = await import("./featureFlag");
    await expect(isSettlementCrisisEnabled({ settlementCrisisEnabled: true })).resolves.toBe(true);
    expect(db.collectionMocks.gameState).toBeUndefined();
  });

  it("fails closed for anything other than an explicit true", async () => {
    const { isSettlementCrisisEnabled } = await import("./featureFlag");
    await expect(isSettlementCrisisEnabled({})).resolves.toBe(false);
    await expect(isSettlementCrisisEnabled({ settlementCrisisEnabled: undefined })).resolves.toBe(
      false
    );
  });

  it("reads gameState with a narrow projection when nothing is preloaded", async () => {
    // MockDb's default findOne resolves null, which is the absent-row case.
    const { isSettlementCrisisEnabled } = await import("./featureFlag");
    await expect(isSettlementCrisisEnabled()).resolves.toBe(false);
    expect(db.collectionMocks.gameState!.findOne).toHaveBeenCalledWith(
      { _id: "current" },
      { projection: { settlementCrisisEnabled: 1 } }
    );
  });

  it("enables when the stored row says true", async () => {
    prime(db, "gameState").findOne.mockResolvedValue({
      _id: "current",
      settlementCrisisEnabled: true,
    });
    const { isSettlementCrisisEnabled } = await import("./featureFlag");
    await expect(isSettlementCrisisEnabled()).resolves.toBe(true);
  });
});
