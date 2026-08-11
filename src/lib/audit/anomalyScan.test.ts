import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import {
  toAnomalyRow,
  detectRapidRepeat,
  detectCircularWire,
  detectWireFanInFanOut,
  detectWashTrade,
  detectPreElectionFundingSurge,
  detectOffHoursPrivilegedAction,
  runAuditAnomalyScan,
  ANOMALY_SCAN_DEFAULTS,
  type AnomalyAuditRow,
} from "./anomalyScan";

const isAuditLogEnabled = vi.fn();
vi.mock("@/lib/audit/featureFlag", () => ({
  isAuditLogEnabled: (...a: unknown[]) => isAuditLogEnabled(...a),
}));

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
}));

// ── Fixture helper ─────────────────────────────────────────────────────
let rowSeq = 0;
function row(over: Partial<AnomalyAuditRow> & { ts: Date }): AnomalyAuditRow {
  rowSeq++;
  return {
    id: `row-${rowSeq}`,
    turn: 100,
    action: "money.fund_debit",
    category: "money",
    actorKey: "u:actor1",
    ...over,
  };
}

beforeEach(() => {
  rowSeq = 0;
  vi.clearAllMocks();
});

describe("toAnomalyRow", () => {
  it("maps a money row's actor/subject/counterparty/amount", () => {
    const userId = new ObjectId();
    const subjectId = new ObjectId();
    const counterpartyId = new ObjectId();
    const doc: ActionAuditRecord = {
      _id: new ObjectId(),
      ts: new Date("2026-01-01T00:00:00Z"),
      turn: 42,
      traceId: "t1",
      source: "api",
      action: "wire.send",
      category: "money",
      actor: { kind: "player", userId },
      subject: { type: "character", id: subjectId },
      counterparty: { type: "character", id: counterpartyId },
      amount: -500,
      outcome: "ok",
      expiresAt: new Date(),
    };
    const mapped = toAnomalyRow(doc);
    expect(mapped.actorKey).toBe(`u:${userId.toString()}`);
    expect(mapped.subjectId).toBe(subjectId.toString());
    expect(mapped.counterpartyId).toBe(counterpartyId.toString());
    expect(mapped.amount).toBe(-500);
  });

  it("reads pricePerShare/orderSide off a share.order buy envelope", () => {
    const doc: ActionAuditRecord = {
      _id: new ObjectId(),
      ts: new Date(),
      turn: 1,
      traceId: "t1",
      source: "api",
      action: "share.order",
      category: "market",
      actor: { kind: "player", characterId: new ObjectId() },
      subject: { type: "corporation", id: new ObjectId() },
      delta: [
        { field: "orderType", before: null, after: "buy" },
        { field: "pricePerShare", before: null, after: 12.5 },
      ],
      outcome: "ok",
      expiresAt: new Date(),
    };
    const mapped = toAnomalyRow(doc);
    expect(mapped.orderSide).toBe("buy");
    expect(mapped.pricePerShare).toBe(12.5);
  });

  it("reads a share.sell envelope as the sell side", () => {
    const doc: ActionAuditRecord = {
      _id: new ObjectId(),
      ts: new Date(),
      turn: 1,
      traceId: "t1",
      source: "api",
      action: "share.sell",
      category: "market",
      actor: { kind: "player", characterId: new ObjectId() },
      subject: { type: "corporation", id: new ObjectId() },
      delta: [{ field: "pricePerShare", before: null, after: 12.5 }],
      outcome: "ok",
      expiresAt: new Date(),
    };
    expect(toAnomalyRow(doc).orderSide).toBe("sell");
  });
});

describe("detectRapidRepeat", () => {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  const config = { rapidRepeatWindowSeconds: 60, rapidRepeatThreshold: 5 };

  it("flags >= threshold same actor+action rows within the window", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({ ts: new Date(base + i * 5000), action: "bond.buy", actorKey: "u:a1" })
    );
    const { flaggedIds, finding } = detectRapidRepeat(rows, config);
    expect(flaggedIds.size).toBe(6);
    expect(finding?.type).toBe("rapid_repeat");
  });

  it("does not flag below the threshold", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      row({ ts: new Date(base + i * 5000), action: "bond.buy", actorKey: "u:a1" })
    );
    const { flaggedIds, finding } = detectRapidRepeat(rows, config);
    expect(flaggedIds.size).toBe(0);
    expect(finding).toBeNull();
  });

  it("does not flag when the same actor bursts across a window wider than the threshold", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({ ts: new Date(base + i * 30_000), action: "bond.buy", actorKey: "u:a1" })
    );
    const { flaggedIds } = detectRapidRepeat(rows, config);
    expect(flaggedIds.size).toBe(0);
  });

  it("does not merge distinct actors into one burst", () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) =>
        row({ ts: new Date(base + i * 1000), action: "bond.buy", actorKey: "u:a1" })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        row({ ts: new Date(base + i * 1000), action: "bond.buy", actorKey: "u:a2" })
      ),
    ];
    const { flaggedIds } = detectRapidRepeat(rows, config);
    expect(flaggedIds.size).toBe(0);
  });
});

describe("detectCircularWire", () => {
  const base = new Date("2026-01-01T00:00:00Z").getTime();

  it("flags a seeded A -> B -> A round trip", () => {
    const rows: AnomalyAuditRow[] = [
      row({
        ts: new Date(base),
        category: "money",
        subjectId: "A",
        counterpartyId: "B",
        amount: -1000,
      }),
      row({
        ts: new Date(base + 1000),
        category: "money",
        subjectId: "B",
        counterpartyId: "A",
        amount: 1000,
      }),
    ];
    const { flaggedIds, finding } = detectCircularWire(rows);
    expect(flaggedIds.size).toBe(2);
    expect(finding?.type).toBe("circular_wire");
  });

  it("does not flag a one-way transfer", () => {
    const rows: AnomalyAuditRow[] = [
      row({
        ts: new Date(base),
        category: "money",
        subjectId: "A",
        counterpartyId: "B",
        amount: -1000,
      }),
    ];
    const { flaggedIds, finding } = detectCircularWire(rows);
    expect(flaggedIds.size).toBe(0);
    expect(finding).toBeNull();
  });
});

describe("detectWireFanInFanOut", () => {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  const config = { fanInThreshold: 4, fanOutThreshold: 4 };

  it("flags a fan-in hub (many distinct senders -> one recipient)", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({
        ts: new Date(base + i * 1000),
        category: "money",
        subjectId: `payer-${i}`,
        counterpartyId: "hub",
        amount: -100,
      })
    );
    const { flaggedIds, finding } = detectWireFanInFanOut(rows, config);
    expect(flaggedIds.size).toBe(5);
    expect(finding?.detail).toContain("fan-in");
  });

  it("flags a fan-out hub (one sender -> many distinct recipients)", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({
        ts: new Date(base + i * 1000),
        category: "money",
        subjectId: "spreader",
        counterpartyId: `recipient-${i}`,
        amount: -100,
      })
    );
    const { flaggedIds, finding } = detectWireFanInFanOut(rows, config);
    expect(flaggedIds.size).toBe(5);
    expect(finding?.detail).toContain("fan-out");
  });

  it("does not flag below threshold", () => {
    const rows = Array.from({ length: 2 }, (_, i) =>
      row({
        ts: new Date(base + i * 1000),
        category: "money",
        subjectId: `payer-${i}`,
        counterpartyId: "hub",
        amount: -100,
      })
    );
    const { flaggedIds } = detectWireFanInFanOut(rows, config);
    expect(flaggedIds.size).toBe(0);
  });
});

describe("detectWashTrade", () => {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  const config = { washTradeWindowSeconds: 300 };

  it("flags a same-actor/same-corp/same-price buy+sell within the window", () => {
    const rows: AnomalyAuditRow[] = [
      row({
        ts: new Date(base),
        category: "market",
        actorKey: "c:char1",
        subjectId: "corpA",
        orderSide: "buy",
        pricePerShare: 10,
      }),
      row({
        ts: new Date(base + 60_000),
        category: "market",
        actorKey: "c:char1",
        subjectId: "corpA",
        orderSide: "sell",
        pricePerShare: 10,
      }),
    ];
    const { flaggedIds, finding } = detectWashTrade(rows, config);
    expect(flaggedIds.size).toBe(2);
    expect(finding?.type).toBe("wash_trade");
  });

  it("does not flag when the price differs", () => {
    const rows: AnomalyAuditRow[] = [
      row({
        ts: new Date(base),
        actorKey: "c:char1",
        subjectId: "corpA",
        orderSide: "buy",
        pricePerShare: 10,
      }),
      row({
        ts: new Date(base + 1000),
        actorKey: "c:char1",
        subjectId: "corpA",
        orderSide: "sell",
        pricePerShare: 11,
      }),
    ];
    expect(detectWashTrade(rows, config).flaggedIds.size).toBe(0);
  });

  it("does not flag outside the window", () => {
    const rows: AnomalyAuditRow[] = [
      row({
        ts: new Date(base),
        actorKey: "c:char1",
        subjectId: "corpA",
        orderSide: "buy",
        pricePerShare: 10,
      }),
      row({
        ts: new Date(base + 600_000),
        actorKey: "c:char1",
        subjectId: "corpA",
        orderSide: "sell",
        pricePerShare: 10,
      }),
    ];
    expect(detectWashTrade(rows, config).flaggedIds.size).toBe(0);
  });
});

describe("detectPreElectionFundingSurge", () => {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  const opts = {
    preElectionFundingWindowSeconds: 3600,
    preElectionMinDistinctPayers: 3,
    preElectionMinTotalAmount: 10_000,
  };

  function surgeRows(): AnomalyAuditRow[] {
    return Array.from({ length: 4 }, (_, i) =>
      row({
        ts: new Date(base + i * 60_000),
        category: "money",
        action: "party.donate",
        subjectId: `payer-${i}`,
        counterpartyId: "partyA",
        amount: -5000,
      })
    );
  }

  it("flags a funding surge only when the pre-election window is active", () => {
    const { flaggedIds, finding } = detectPreElectionFundingSurge(surgeRows(), {
      ...opts,
      isPreElectionWindow: true,
    });
    expect(flaggedIds.size).toBe(4);
    expect(finding?.type).toBe("pre_election_funding_surge");
  });

  it("does not flag the same data outside the pre-election window", () => {
    const { flaggedIds, finding } = detectPreElectionFundingSurge(surgeRows(), {
      ...opts,
      isPreElectionWindow: false,
    });
    expect(flaggedIds.size).toBe(0);
    expect(finding).toBeNull();
  });

  it("does not flag below the distinct-payer/total thresholds", () => {
    const rows = [
      row({
        ts: new Date(base),
        category: "money",
        action: "party.donate",
        subjectId: "payer-0",
        counterpartyId: "partyA",
        amount: -100,
      }),
    ];
    const { flaggedIds } = detectPreElectionFundingSurge(rows, {
      ...opts,
      isPreElectionWindow: true,
    });
    expect(flaggedIds.size).toBe(0);
  });
});

describe("detectOffHoursPrivilegedAction", () => {
  const config = { offHoursStartUtcHour: 2, offHoursEndUtcHour: 6 };

  it("flags an admin action inside the off-hours UTC window", () => {
    const rows = [row({ ts: new Date("2026-01-01T03:30:00Z"), category: "admin" })];
    const { flaggedIds, finding } = detectOffHoursPrivilegedAction(rows, config);
    expect(flaggedIds.size).toBe(1);
    expect(finding?.type).toBe("off_hours_privileged_action");
  });

  it("does not flag a non-admin row in the same window", () => {
    const rows = [row({ ts: new Date("2026-01-01T03:30:00Z"), category: "money" })];
    expect(detectOffHoursPrivilegedAction(rows, config).flaggedIds.size).toBe(0);
  });

  it("does not flag an admin action outside the off-hours window", () => {
    const rows = [row({ ts: new Date("2026-01-01T14:00:00Z"), category: "admin" })];
    expect(detectOffHoursPrivilegedAction(rows, config).flaggedIds.size).toBe(0);
  });

  it("handles a midnight-wrapping window", () => {
    const wrapping = { offHoursStartUtcHour: 22, offHoursEndUtcHour: 6 };
    const late = [row({ ts: new Date("2026-01-01T23:00:00Z"), category: "admin" })];
    const early = [row({ ts: new Date("2026-01-01T04:00:00Z"), category: "admin" })];
    const midday = [row({ ts: new Date("2026-01-01T12:00:00Z"), category: "admin" })];
    expect(detectOffHoursPrivilegedAction(late, wrapping).flaggedIds.size).toBe(1);
    expect(detectOffHoursPrivilegedAction(early, wrapping).flaggedIds.size).toBe(1);
    expect(detectOffHoursPrivilegedAction(midday, wrapping).flaggedIds.size).toBe(0);
  });
});

// ── Scenario test: DB wrapper end-to-end over a seeded circular wire ─────
describe("runAuditAnomalyScan", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    isAuditLogEnabled.mockResolvedValue(true);
  });

  it("flags a seeded circular wire back onto actionAuditLog and writes an auditAnomalies summary", async () => {
    const idA = new ObjectId();
    const idB = new ObjectId();
    const now = new Date("2026-01-01T00:00:00Z");
    const docs: ActionAuditRecord[] = [
      {
        _id: idA,
        ts: now,
        turn: 100,
        traceId: "t1",
        source: "api",
        action: "wire.send",
        category: "money",
        actor: { kind: "player" },
        subject: { type: "character", id: "A" },
        counterparty: { type: "character", id: "B" },
        amount: -1000,
        outcome: "ok",
        expiresAt: new Date(),
      },
      {
        _id: idB,
        ts: new Date(now.getTime() + 1000),
        turn: 100,
        traceId: "t2",
        source: "api",
        action: "wire.receive",
        category: "money",
        actor: { kind: "player" },
        subject: { type: "character", id: "B" },
        counterparty: { type: "character", id: "A" },
        amount: 1000,
        outcome: "ok",
        expiresAt: new Date(),
      },
    ];

    db.collectionMocks.actionAuditLog = {
      ...db.collection("actionAuditLog"),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(docs) }),
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    } as never;
    // Narrow elections lookup — no upcoming election, so pre-election-only
    // detector stays inert; circular_wire doesn't depend on it.
    db.collectionMocks.elections = {
      ...db.collection("elections"),
      findOne: vi.fn().mockResolvedValue(null),
    } as never;

    const result = await runAuditAnomalyScan(db as unknown as Db, 100);

    expect(result).not.toBeNull();
    expect(result?.scannedRows).toBe(2);
    expect(result?.flaggedRows).toBe(2);
    expect(result?.findings.some((f) => f.type === "circular_wire")).toBe(true);

    const bulkWriteCalls = db.collectionMocks.actionAuditLog.bulkWrite.mock.calls;
    expect(bulkWriteCalls.length).toBe(1);
    const ops = bulkWriteCalls[0][0] as Array<{
      updateOne: {
        filter: { _id: ObjectId };
        update: { $addToSet: { flags: { $each: string[] } } };
      };
    }>;
    const flaggedIds = ops.map((op) => op.updateOne.filter._id.toString());
    expect(flaggedIds).toEqual(expect.arrayContaining([idA.toString(), idB.toString()]));
    const flagTypes = ops.flatMap((op) => op.updateOne.update.$addToSet.flags.$each);
    expect(flagTypes).toContain("circular_wire");

    expect(db.collectionMocks.auditAnomalies.insertOne).toHaveBeenCalledTimes(1);
    const summary = db.collectionMocks.auditAnomalies.insertOne.mock.calls[0][0];
    expect(summary.turn).toBe(100);
    expect(summary.scannedRows).toBe(2);
    expect(summary.flaggedRows).toBe(2);
  });

  it("is a no-op when the audit log flag is off", async () => {
    isAuditLogEnabled.mockResolvedValue(false);

    db.collectionMocks.actionAuditLog = db.collection("actionAuditLog") as never;

    const result = await runAuditAnomalyScan(db as unknown as Db, 100);

    expect(result).toBeNull();
    expect(db.collectionMocks.actionAuditLog.find).not.toHaveBeenCalled();
  });

  it("is a no-op when the window has no rows", async () => {
    db.collectionMocks.actionAuditLog = {
      ...db.collection("actionAuditLog"),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as never;

    const result = await runAuditAnomalyScan(db as unknown as Db, 100);

    expect(result).toBeNull();
  });

  it("captures to Sentry and rethrows when the underlying query fails", async () => {
    db.collectionMocks.actionAuditLog = {
      ...db.collection("actionAuditLog"),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockRejectedValue(new Error("boom")),
      }),
    } as never;

    await expect(runAuditAnomalyScan(db as unknown as Db, 100)).rejects.toThrow("boom");
    expect(captureException).toHaveBeenCalled();
  });
});

// Keep the default config sane for the detectors above (documents the
// tuned thresholds so a future config-knob change is a deliberate diff).
describe("ANOMALY_SCAN_DEFAULTS", () => {
  it("has positive thresholds for every detector", () => {
    expect(ANOMALY_SCAN_DEFAULTS.rapidRepeatThreshold).toBeGreaterThan(0);
    expect(ANOMALY_SCAN_DEFAULTS.fanInThreshold).toBeGreaterThan(0);
    expect(ANOMALY_SCAN_DEFAULTS.fanOutThreshold).toBeGreaterThan(0);
    expect(ANOMALY_SCAN_DEFAULTS.washTradeWindowSeconds).toBeGreaterThan(0);
    expect(ANOMALY_SCAN_DEFAULTS.preElectionMinDistinctPayers).toBeGreaterThan(0);
    expect(ANOMALY_SCAN_DEFAULTS.offHoursEndUtcHour).not.toBe(
      ANOMALY_SCAN_DEFAULTS.offHoursStartUtcHour
    );
  });
});
