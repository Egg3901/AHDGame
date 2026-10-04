import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";

const order: string[] = [];
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/financialTxLog/suspectScan", () => ({
  runFinancialSuspectScan: vi.fn(async () => {
    order.push("financialSuspectScan");
  }),
}));
vi.mock("@/lib/audit/anomalyScan", () => ({
  runAuditAnomalyScan: vi.fn(async () => {
    order.push("auditAnomalyScan");
    return { scannedRows: 10, flaggedRows: 2 };
  }),
}));
vi.mock("@/lib/turn/suspiciousDetection", () => ({
  processSuspiciousDetection: vi.fn(async () => {
    order.push("suspiciousDetection");
    return { flagged: 1, cleared: 0, deleted: 0 };
  }),
}));

import { isPostTurnScanTurn, runPostTurnIntegrityScans } from "./postTurnScans";

function mockDb() {
  const updateOne = vi.fn(async () => ({ acknowledged: true }));
  return { db: { collection: () => ({ updateOne }) } as unknown as Db, updateOne };
}

describe("runPostTurnIntegrityScans (#2694)", () => {
  beforeEach(() => {
    order.length = 0;
    globalThis._ahdPostTurnScansRunning = false;
  });

  it("runs the three scans in order and records results on the turn log", async () => {
    const { db, updateOne } = mockDb();
    const records = await runPostTurnIntegrityScans(db, 9, { everyTurns: 3 });
    expect(order).toEqual(["financialSuspectScan", "auditAnomalyScan", "suspiciousDetection"]);
    expect(records?.auditAnomalyScan.result).toEqual({ scannedRows: 10, flaggedRows: 2 });
    const final = updateOne.mock.calls.at(-1) as unknown as [
      unknown,
      { $set: { postTurnScans: { status: string } } },
    ];
    expect(final[1].$set.postTurnScans.status).toBe("completed");
  });

  it("skips off-cadence turns", async () => {
    const { db, updateOne } = mockDb();
    expect(await runPostTurnIntegrityScans(db, 10, { everyTurns: 3 })).toBeNull();
    expect(order).toEqual([]);
    expect(updateOne).not.toHaveBeenCalled();
    expect(isPostTurnScanTurn(10, 1)).toBe(true);
  });

  it("records a failed scan and still runs the rest", async () => {
    const { runAuditAnomalyScan } = await import("@/lib/audit/anomalyScan");
    vi.mocked(runAuditAnomalyScan).mockRejectedValueOnce(new Error("boom"));
    const { db, updateOne } = mockDb();
    const records = await runPostTurnIntegrityScans(db, 6, { everyTurns: 3 });
    expect(records?.auditAnomalyScan.status).toBe("failed");
    expect(records?.suspiciousDetection.status).toBe("completed");
    const final = updateOne.mock.calls.at(-1) as unknown as [
      unknown,
      { $set: { postTurnScans: { status: string } } },
    ];
    expect(final[1].$set.postTurnScans.status).toBe("failed");
  });

  it("skips and records when a previous run is still going", async () => {
    globalThis._ahdPostTurnScansRunning = true;
    const { db, updateOne } = mockDb();
    expect(await runPostTurnIntegrityScans(db, 3, { everyTurns: 3 })).toBeNull();
    expect(order).toEqual([]);
    const call = updateOne.mock.calls[0] as unknown as [
      unknown,
      { $set: { postTurnScans: { status: string } } },
    ];
    expect(call[1].$set.postTurnScans.status).toBe("skipped");
  });
});
