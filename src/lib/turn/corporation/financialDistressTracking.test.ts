import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const createNotifications = vi.fn();
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...a: unknown[]) => createNotifications(...a),
}));

describe("trackFinancialDistress", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["corporations", "bonds"]) db.collection(n);
    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [] });
  });

  function playerCorp(over: Record<string, unknown>) {
    return {
      _id: new ObjectId(),
      userId: new ObjectId(),
      name: "Acme",
      sequentialId: 42,
      liquidCapital: 1000,
      ...over,
    };
  }

  it("stamps financialDistressSinceTurn and notifies the owner on entering insolvency", async () => {
    const corp = playerCorp({ liquidCapital: -5 });
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [corp] });

    const { trackFinancialDistress } = await import("./financialDistressTracking");
    await trackFinancialDistress(db as unknown as Db, 100);

    const ops = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update).toEqual({ $set: { financialDistressSinceTurn: 100 } });
    expect(createNotifications).toHaveBeenCalledTimes(1);
    expect(createNotifications.mock.calls[0][0][0]).toMatchObject({
      userId: corp.userId,
      type: "corp_nationalization_risk",
    });
  });

  it("does not re-stamp or re-notify a corp already flagged", async () => {
    const corp = playerCorp({ liquidCapital: -5, financialDistressSinceTurn: 90 });
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [corp] });
    const { trackFinancialDistress } = await import("./financialDistressTracking");
    await trackFinancialDistress(db as unknown as Db, 100);
    expect(db.collectionMocks.corporations.bulkWrite).not.toHaveBeenCalled();
    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("clears the field when a corp exits distress", async () => {
    const corp = playerCorp({ liquidCapital: 500, financialDistressSinceTurn: 90 });
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [corp] });
    const { trackFinancialDistress } = await import("./financialDistressTracking");
    await trackFinancialDistress(db as unknown as Db, 100);
    const ops = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.update).toEqual({ $unset: { financialDistressSinceTurn: "" } });
    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("treats a defaulted unmatured bond as distress", async () => {
    const corp = playerCorp({ liquidCapital: 500 });
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [corp] });
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [{ corporationId: corp._id }],
    });
    const { trackFinancialDistress } = await import("./financialDistressTracking");
    await trackFinancialDistress(db as unknown as Db, 100);
    expect(db.collectionMocks.corporations.bulkWrite.mock.calls[0][0][0].updateOne.update).toEqual({
      $set: { financialDistressSinceTurn: 100 },
    });
  });

  it("skips an NPC corp (no userId) even if insolvent", async () => {
    const npc = { _id: new ObjectId(), name: "StateCo", liquidCapital: -999 };
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [npc] });
    const { trackFinancialDistress } = await import("./financialDistressTracking");
    await trackFinancialDistress(db as unknown as Db, 100);
    expect(db.collectionMocks.corporations.bulkWrite).not.toHaveBeenCalled();
    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("no-ops when there are no player corps", async () => {
    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [] });
    const { trackFinancialDistress } = await import("./financialDistressTracking");
    await trackFinancialDistress(db as unknown as Db, 100);
    expect(db.collectionMocks.corporations.bulkWrite).not.toHaveBeenCalled();
    expect(createNotifications).not.toHaveBeenCalled();
  });
});
