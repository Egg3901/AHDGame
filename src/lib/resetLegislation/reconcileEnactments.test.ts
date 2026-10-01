import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./enactBill", () => ({ applyResetLawBillEnactment: vi.fn() }));

import { applyResetLawBillEnactment } from "./enactBill";
import { reconcileResetLawEnactments } from "./reconcileEnactments";

describe("reconcileResetLawEnactments", () => {
  let db: MockDb;
  const cursor = (rows: unknown[]) => ({ toArray: vi.fn().mockResolvedValue(rows) });

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
  });

  it("retries only enacted v2 bills without a matching receipt", async () => {
    const missingId = new ObjectId();
    db.collectionMocks.bills!.aggregate.mockReturnValue(
      cursor([{ _id: missingId, countryId: "US", provisions: [{ type: "reset_law" }] }])
    );
    vi.mocked(applyResetLawBillEnactment).mockResolvedValue({ applied: true, programs: 1 });

    await expect(reconcileResetLawEnactments(db as unknown as Db, 12)).resolves.toEqual({
      candidates: 1,
      applied: 1,
    });
    expect(db.collectionMocks.bills!.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ $unionWith: expect.objectContaining({ coll: "stateBills" }) }),
        { $match: { "receipts.0": { $exists: false } } },
        { $limit: 1 },
      ])
    );
    expect(applyResetLawBillEnactment).toHaveBeenCalledOnce();
    expect(applyResetLawBillEnactment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: missingId }),
      12
    );
  });

  it("does no transactional work when every enacted bill has a receipt", async () => {
    db.collectionMocks.bills!.aggregate.mockReturnValue(cursor([]));

    await expect(reconcileResetLawEnactments(db as unknown as Db, 12)).resolves.toEqual({
      candidates: 0,
      applied: 0,
    });
    expect(applyResetLawBillEnactment).not.toHaveBeenCalled();
  });
});
