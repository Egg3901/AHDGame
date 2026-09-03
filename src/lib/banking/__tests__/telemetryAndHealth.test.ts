import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { countBankingEvent, recordBankingStage, timedBankingStage } from "@/lib/banking/telemetry";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { buildBankingHealth } from "@/lib/banking/health";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("banking telemetry", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bankingTelemetry").updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("bumps a counter with an upsert keyed by turn", async () => {
    countBankingEvent(db as unknown as Db, 42, "rejectedCommands", 3);
    await flushMicrotasks();
    const [filter, update, options] = db.collectionMocks.bankingTelemetry!.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 42 });
    expect((update as { $inc: Record<string, number> }).$inc).toEqual({
      "counters.rejectedCommands": 3,
    });
    expect(options).toEqual({ upsert: true });
  });

  it("ignores non-positive and non-finite input", async () => {
    countBankingEvent(db as unknown as Db, 42, "staleCommands", 0);
    countBankingEvent(db as unknown as Db, Number.NaN, "staleCommands", 1);
    recordBankingStage(db as unknown as Db, 42, "funding", -1);
    await flushMicrotasks();
    expect(db.collectionMocks.bankingTelemetry!.updateOne).not.toHaveBeenCalled();
  });

  it("records a stage duration and run count", async () => {
    const value = await timedBankingStage(db as unknown as Db, 7, "loanServicing", async () => 99);
    expect(value).toBe(99);
    await flushMicrotasks();
    const update = db.collectionMocks.bankingTelemetry!.updateOne.mock.calls[0][1] as {
      $inc: Record<string, number>;
    };
    expect(update.$inc["stageRuns.loanServicing"]).toBe(1);
    expect(update.$inc["stageMs.loanServicing"]).toBeGreaterThanOrEqual(0);
  });

  it("never throws when the driver rejects or a mock returns nothing", async () => {
    db.collectionMocks.bankingTelemetry!.updateOne.mockRejectedValue(new Error("down"));
    expect(() => countBankingEvent(db as unknown as Db, 1, "replayedSettlements")).not.toThrow();
    db.collectionMocks.bankingTelemetry!.updateOne.mockReturnValue(undefined);
    expect(() => recordBankingStage(db as unknown as Db, 1, "solvency", 5)).not.toThrow();
    await flushMicrotasks();
  });
});

describe("emitBankingAuditEvent", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bankingTelemetry").updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("writes the projected envelope to the audit spine", async () => {
    const { recordAudit } = await import("@/lib/audit/recordAudit");
    emitBankingAuditEvent({
      kind: "loan.originated",
      command: "bank.loan.originate",
      turn: 10,
      outcome: "ok",
      currency: "USD",
      bankId: "a".repeat(24),
      subjectType: "loan",
      subjectId: "b".repeat(24),
      statusAfter: "current",
      amount: 1_000,
      meta: { termTurns: 48 },
    });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const record = vi.mocked(recordAudit).mock.calls[0][0];
    expect(record.action).toBe("bank.loan.originated");
    expect(record.category).toBe("money");
    expect(record.turn).toBe(10);
    expect(record.subject).toEqual({ type: "loan", id: "b".repeat(24) });
    expect(record.amount).toBe(1_000);
    expect(record.currencyCode).toBe("USD");
    expect(record.refs).toEqual({ corporationId: "a".repeat(24) });
    expect(record.meta).toMatchObject({ kind: "loan.originated", statusAfter: "current" });
    expect(typeof record.traceId).toBe("string");
  });

  it("counts a rejection as rejected or stale depending on the reason", async () => {
    emitBankingAuditEvent(
      {
        kind: "loan.approved",
        command: "bank.loan.approve",
        turn: 11,
        outcome: "rejected",
        reason: "Loan is not pending",
      },
      db as unknown as Db
    );
    emitBankingAuditEvent(
      {
        kind: "loan.originated",
        command: "bank.loan.originate",
        turn: 11,
        outcome: "rejected",
        reason: "Principal exceeds lendable headroom (max 5)",
      },
      db as unknown as Db
    );
    await flushMicrotasks();
    const incs = db.collectionMocks.bankingTelemetry!.updateOne.mock.calls.map(
      (call) => Object.keys((call[1] as { $inc: Record<string, number> }).$inc)[0]
    );
    expect(incs.sort()).toEqual(["counters.rejectedCommands", "counters.staleCommands"]);
  });

  it("drops an event carrying private data instead of throwing", async () => {
    const { recordAudit } = await import("@/lib/audit/recordAudit");
    expect(() =>
      emitBankingAuditEvent({
        kind: "charter.issued",
        command: "bank.charter.issue",
        turn: 1,
        outcome: "ok",
        meta: { ownerName: "someone" },
      })
    ).not.toThrow();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("buildBankingHealth", () => {
  let db: MockDb;
  const bankA = new ObjectId();
  const bankB = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "corporations",
      "characters",
      "centralBanks",
      "gameState",
      "bankMoneyMoves",
      "bankingTelemetry",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.corporations!.find.mockReturnValue(
      cursor([
        {
          _id: bankA,
          bankCharter: {
            type: "retail",
            status: "active",
            currency: "USD",
            cashReserves: 100_000,
            npcDeposits: 2_000_000,
            totalDeposits: 2_500_000,
            totalLoans: 1_800_000,
          },
        },
        {
          _id: bankB,
          bankCharter: {
            type: "retail",
            status: "active",
            currency: "USD",
            cashReserves: 900_000,
            npcDeposits: 1_000_000,
            totalDeposits: 1_000_000,
            totalLoans: 100_000,
          },
        },
      ])
    );
    db.collectionMocks.characters!.find.mockReturnValue(
      cursor([
        {
          currencyBalances: { savingsHolder: { USD: bankA.toString() }, savings: { USD: 250_000 } },
        },
        {
          currencyBalances: { savingsHolder: { USD: bankA.toString() }, savings: { USD: 150_000 } },
        },
        {
          currencyBalances: { savingsHolder: { USD: bankB.toString() }, savings: { USD: 50_000 } },
        },
      ])
    );
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      bankReserveRequirement: 0.1,
    });
    const old = new Date(Date.now() - 3_600_000);
    db.collectionMocks.bankMoneyMoves!.find.mockReturnValue(
      cursor([
        { _id: "loan-service:x:5", kind: "loan_service", status: "partial", createdAt: old },
        {
          _id: "npc-deposit-in:y:6",
          kind: "npc_deposit_flow",
          status: "partial",
          createdAt: new Date(),
        },
      ])
    );
    db.collectionMocks.bankingTelemetry!.find.mockReturnValue(
      cursor([{ _id: 6, counters: { replayedSettlements: 2 } }])
    );
  });

  it("reconciles pointer deposits per currency and reports reserve breaches", async () => {
    const report = await buildBankingHealth(db as unknown as Db, new Date());
    expect(report.currencies).toHaveLength(1);
    const usd = report.currencies[0];
    expect(usd.currency).toBe("USD");
    expect(usd.activeBanks).toBe(2);
    expect(usd.playerHeldAtBanks).toBe(450_000);
    // Bank A claims 500k of pointer deposits but characters hold 400k at it.
    expect(usd.charterPointerDeposits).toBe(500_000);
    expect(usd.pointerDrift).toBe(-50_000);
    expect(usd.cashBackedDeposits).toBe(3_000_000);
    expect(usd.requiredReserves).toBe(300_000);
    // Bank A: cash 100k against 200k required, under the run line too.
    expect(usd.banksUnderReserve).toBe(1);
    expect(usd.banksUnderRunLine).toBe(0);
  });

  it("reports the oldest unfinished settlement and the kind breakdown", async () => {
    const report = await buildBankingHealth(db as unknown as Db, new Date());
    expect(report.unfinishedSettlements.count).toBe(2);
    expect(report.unfinishedSettlements.oldestKey).toBe("loan-service:x:5");
    expect(report.unfinishedSettlements.oldestAgeMs).toBeGreaterThanOrEqual(3_599_000);
    expect(report.unfinishedSettlements.byKind).toEqual({
      loan_service: 1,
      npc_deposit_flow: 1,
    });
    expect(report.telemetry[0]).toMatchObject({ _id: 6 });
  });
});
