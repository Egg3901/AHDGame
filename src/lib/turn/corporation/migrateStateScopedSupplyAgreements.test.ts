import { describe, expect, it, vi } from "vitest";
import type { Collection, UpdateResult } from "mongodb";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";
import { CONTRACT_CANCEL_NOTICE_TURNS } from "@/lib/db/types/supplyAgreement";
import { migrateStateScopedSupplyAgreements } from "./migrateStateScopedSupplyAgreements";

function result(modifiedCount: number): UpdateResult {
  return {
    acknowledged: true,
    matchedCount: modifiedCount,
    modifiedCount,
    upsertedCount: 0,
    upsertedId: null,
  };
}

describe("migrateStateScopedSupplyAgreements", () => {
  it("withdraws legacy pending freight and gives legacy live freight the normal cancellation notice", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce(result(2))
      .mockResolvedValueOnce(result(3))
      .mockResolvedValueOnce(result(1));
    const agreements = { updateMany } as unknown as Collection<SupplyAgreement>;
    const now = new Date("2026-08-24T00:00:00.000Z");

    const migrated = await migrateStateScopedSupplyAgreements({ agreements, turn: 14, now });

    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      // Only contracts with no state identity are legacy; a state-scoped
      // freight contract names its state and is left alone.
      { status: "pending", commodity: { $in: ["freight"] }, stateId: { $exists: false } },
      { $set: { status: "cancelled", updatedAt: now } }
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      { status: "active", commodity: { $in: ["freight"] }, stateId: { $exists: false } },
      {
        $set: {
          status: "cancelling",
          cancelEffectiveTurn: 14 + CONTRACT_CANCEL_NOTICE_TURNS,
          updatedAt: now,
        },
      }
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      3,
      { status: "cancelling", cancelEffectiveTurn: { $lte: 14 } },
      { $set: { status: "cancelled", updatedAt: now } }
    );
    expect(migrated).toEqual({ pendingCancelled: 2, noticeServed: 3, noticeExpired: 1 });
  });
});
