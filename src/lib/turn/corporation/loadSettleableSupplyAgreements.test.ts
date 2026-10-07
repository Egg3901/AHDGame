import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { loadSettleableSupplyAgreements } from "./loadSettleableSupplyAgreements";

describe("loadSettleableSupplyAgreements", () => {
  it("retires fixed-term agreements before loading the settlement book", async () => {
    const db = createMockDb();
    db.collection("supplyAgreements");
    const agreements = db.collectionMocks.supplyAgreements;
    const now = new Date("2026-09-12T00:00:00.000Z");

    const loaded = await loadSettleableSupplyAgreements({
      db: db as unknown as Db,
      turn: 68,
      now,
    });

    expect(agreements.updateMany).toHaveBeenNthCalledWith(
      1,
      { status: { $in: ["active", "cancelling"] }, expiresAtTurn: { $lte: 68 } },
      { $set: { status: "cancelled", updatedAt: now }, $unset: { cancelEffectiveTurn: "" } }
    );
    expect(agreements.updateMany).toHaveBeenCalledTimes(4);
    expect(loaded).toEqual({ agreements: [], legacyStateLocalAgreementLive: false });
  });

  it("tells both CEOs when a fixed-term agreement expires", async () => {
    vi.resetModules();
    const createNotification = vi.fn();
    vi.doMock("@/lib/notifications", () => ({ createNotification }));
    const { loadSettleableSupplyAgreements: load } =
      await import("./loadSettleableSupplyAgreements");
    const db = createMockDb();
    const supplier = { _id: new ObjectId(), userId: new ObjectId() };
    const buyer = { _id: new ObjectId(), userId: new ObjectId() };
    db.collection("supplyAgreements").find.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          supplierCorpId: supplier._id,
          buyerCorpId: buyer._id,
          commodity: "steel",
          status: "active",
        },
      ]),
    });
    db.collection("corporations").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([supplier, buyer]),
    });
    await load({ db: db as unknown as Db, turn: 68, now: new Date() });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: supplier.userId,
        type: "corp_supply_agreement_update",
        metadata: expect.objectContaining({ event: "expired" }),
      })
    );
  });
});
