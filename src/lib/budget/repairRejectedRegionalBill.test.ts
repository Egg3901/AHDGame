import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { StateBill } from "@/lib/db/types/stateBill";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/budget/validation", () => ({ validateStateBudgetImpact: vi.fn() }));
vi.mock("@/lib/turn/billLifecycle/regionalEngine", () => ({
  finalizeStateBillEnactment: vi.fn(),
}));

import { validateStateBudgetImpact } from "@/lib/budget/validation";
import { finalizeStateBillEnactment } from "@/lib/turn/billLifecycle/regionalEngine";
import { repairRejectedRegionalBill } from "./repairRejectedRegionalBill";

const billId = new ObjectId("6ab460000000000000000001");
const rejectedAt = new Date("2026-09-23T13:02:05.628Z");
const bill = {
  _id: billId,
  stateId: "BY",
  countryId: "DD",
  status: "failed",
  legislationTypeId: "dd.infrastructure.publicHousing.primary",
  governorAction: "vetoed",
  overrideVoteSnapshot: { totals: { for: 203, against: 0, abstain: 0 } },
  budgetRejection: { error: "INSUFFICIENT_FUNDS", costAmount: 1_200_000_000, rejectedAt },
  updatedAt: new Date("2026-09-23T13:02:05.628Z"),
} as StateBill;

describe("repairRejectedRegionalBill", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of ["stateBills", "regionalBudgets", "statePolicies", "enactedLaws"])
      db.collection(name);
    db.collectionMocks.stateBills.findOne.mockResolvedValue(bill);
    db.collectionMocks.regionalBudgets.findOne.mockResolvedValue({ _id: "BY", countryId: "DD" });
    db.collectionMocks.statePolicies.findOne.mockResolvedValue(null);
    db.collectionMocks.enactedLaws.findOne.mockResolvedValue({ billId });
    vi.mocked(validateStateBudgetImpact).mockResolvedValue({
      allowed: true,
      costAmount: 1_200_000_000,
      newTotalSpending: 21_000_000_000,
      newBalance: 77_000_000_000,
    });
    vi.mocked(finalizeStateBillEnactment).mockResolvedValue({ enacted: true });
  });

  it("previews a replay without changing the bill", async () => {
    const result = await repairRejectedRegionalBill(
      db as unknown as Db,
      billId,
      rejectedAt,
      1097,
      false
    );

    expect(result).toEqual({
      applied: false,
      costAmount: 1_200_000_000,
      newBalance: 77_000_000_000,
    });
    expect(db.collectionMocks.stateBills.updateOne).not.toHaveBeenCalled();
    expect(finalizeStateBillEnactment).not.toHaveBeenCalled();
  });

  it("claims the failed override once and verifies its enacted policy", async () => {
    db.collectionMocks.statePolicies.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ enactedByBillId: billId });

    const result = await repairRejectedRegionalBill(
      db as unknown as Db,
      billId,
      rejectedAt,
      1097,
      true
    );

    expect(result.applied).toBe(true);
    expect(db.collectionMocks.stateBills.updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.stateBills.updateOne.mock.calls[0][1].$set.status).toBe(
      "override_closing"
    );
    expect(finalizeStateBillEnactment).toHaveBeenCalledWith(db, bill, 1097);
    expect(db.collectionMocks.enactedLaws.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ billId, countryId: "DD", stateId: "BY" })
    );
    expect(db.collectionMocks.stateBills.updateOne.mock.calls[1][1].$set.status).toBe("enacted");
  });

  it("refuses a bill with a newer policy", async () => {
    db.collectionMocks.statePolicies.findOne.mockResolvedValue({
      enactedAt: new Date("2026-09-24T00:00:00Z"),
    });

    await expect(
      repairRejectedRegionalBill(db as unknown as Db, billId, rejectedAt, 1097, true)
    ).rejects.toThrow("newer");
    expect(db.collectionMocks.stateBills.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a bill whose rejection changed", async () => {
    await expect(
      repairRejectedRegionalBill(
        db as unknown as Db,
        billId,
        new Date("2026-09-23T13:03:00Z"),
        1097,
        true
      )
    ).rejects.toThrow("no longer matches");
    expect(db.collectionMocks.stateBills.updateOne).not.toHaveBeenCalled();
  });
});
