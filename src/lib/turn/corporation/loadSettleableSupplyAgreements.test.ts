import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
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
});
