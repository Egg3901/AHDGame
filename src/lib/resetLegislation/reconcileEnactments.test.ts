import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./enactBill", () => ({ applyResetLawBillEnactment: vi.fn() }));

import { applyResetLawBillEnactment } from "./enactBill";
import { reconcileResetLawEnactments } from "./reconcileEnactments";

const v2State = {
  _id: "current",
  resetWorldId: "world-1",
  metricsSystemVersion: "v2",
  legislationSystemVersion: "v2",
  resetVersionSeeds: {
    metrics: {
      worldId: "world-1",
      revision: 3,
      sourceTurn: 1,
      completedAt: "2026-10-04T00:00:00.000Z",
      verificationHash: "metrics",
    },
    legislation: {
      worldId: "world-1",
      revision: 6,
      sourceTurn: 1,
      completedAt: "2026-10-04T00:00:00.000Z",
      verificationHash: "legislation",
    },
  },
} as never;

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

    await expect(reconcileResetLawEnactments(db as unknown as Db, 12, v2State)).resolves.toEqual({
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

    await expect(reconcileResetLawEnactments(db as unknown as Db, 12, v2State)).resolves.toEqual({
      candidates: 0,
      applied: 0,
    });
    expect(applyResetLawBillEnactment).not.toHaveBeenCalled();
  });

  it("does not scan v2 enactments in a v1 world", async () => {
    await expect(
      reconcileResetLawEnactments(db as unknown as Db, 12, { _id: "current" } as never)
    ).resolves.toEqual({ candidates: 0, applied: 0 });
    expect(db.collectionMocks.bills!.aggregate).not.toHaveBeenCalled();
  });
});
