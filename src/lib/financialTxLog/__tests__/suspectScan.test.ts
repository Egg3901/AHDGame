import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { runFinancialSuspectScan } from "../suspectScan";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

interface MinimalTx {
  _id: ObjectId;
  type: string;
  turn: number;
  createdAt: Date;
  subjectType: "character" | "corporation";
  subjectId?: ObjectId;
  counterpartyId?: ObjectId;
  amount: number;
  currencyCode: string;
  meta?: Record<string, unknown>;
  suspectFlags?: unknown;
}

function setupDb(window: MinimalTx[], snapshots: unknown[] = [], rates: unknown[] = []) {
  const db = createMockDb();
  for (const name of [
    "financialTxLog",
    "systemSettings",
    "exchangeRates",
    "portfolioHistory",
    "corporationPortfolioHistory",
  ]) {
    db.collection(name);
  }
  db.collectionMocks.systemSettings.findOne.mockResolvedValue(null);
  db.collectionMocks.financialTxLog.find.mockReturnValue(makeCursor(window));
  db.collectionMocks.financialTxLog.createIndex.mockResolvedValue("financialTxLog_turn_desc");
  db.collectionMocks.financialTxLog.updateMany.mockResolvedValue({ modifiedCount: 0 });
  db.collectionMocks.exchangeRates.find.mockReturnValue(makeCursor(rates));
  db.collectionMocks.portfolioHistory.find.mockReturnValue(makeCursor(snapshots));
  db.collectionMocks.corporationPortfolioHistory.find.mockReturnValue(makeCursor([]));
  // bulkWrite captures the flag updates we want to assert on.
  db.collectionMocks.financialTxLog.bulkWrite.mockResolvedValue({ modifiedCount: 0 });
  return db;
}

function findFlagOps(db: MockDb): {
  id: string;
  flags: { type: string; severity: string }[];
}[] {
  const calls = db.collectionMocks.financialTxLog.bulkWrite.mock.calls;
  if (calls.length === 0) return [];
  const ops = calls[0][0] as Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update: { $push: { suspectFlags: { $each: { type: string; severity: string }[] } } };
    };
  }>;
  return ops.map((op) => ({
    id: op.updateOne.filter._id.toString(),
    flags: op.updateOne.update.$push.suspectFlags.$each,
  }));
}

describe("runFinancialSuspectScan — Phase 6 detectors", () => {
  let charId: ObjectId;
  let corpId: ObjectId;

  beforeEach(() => {
    charId = new ObjectId();
    corpId = new ObjectId();
  });

  describe("time_velocity", () => {
    it("flags 10 same-type tx by same subject within 60s", async () => {
      const base = new Date("2026-04-27T01:25:00Z").getTime();
      const window: MinimalTx[] = [];
      for (let i = 0; i < 10; i++) {
        window.push({
          _id: new ObjectId(),
          type: "bond_purchase",
          turn: 387,
          createdAt: new Date(base + i * 5000), // 0s, 5s, 10s … 45s
          subjectType: "character",
          subjectId: charId,
          amount: -1_000_000,
          currencyCode: "USD",
        });
      }
      const db = setupDb(window);
      await runFinancialSuspectScan(db as never, 387);

      const flagged = findFlagOps(db);
      expect(flagged).toHaveLength(10);
      for (const op of flagged) {
        expect(op.flags.some((f) => f.type === "time_velocity")).toBe(true);
      }
    });

    it("does NOT flag when only 9 tx in 60s window (under threshold)", async () => {
      const base = new Date("2026-04-27T01:25:00Z").getTime();
      const window: MinimalTx[] = [];
      for (let i = 0; i < 9; i++) {
        window.push({
          _id: new ObjectId(),
          type: "bond_purchase",
          turn: 387,
          createdAt: new Date(base + i * 5000),
          subjectType: "character",
          subjectId: charId,
          amount: -1_000_000,
          currencyCode: "USD",
        });
      }
      const db = setupDb(window);
      await runFinancialSuspectScan(db as never, 387);
      const flagged = findFlagOps(db);
      const timeVel = flagged.flatMap((o) => o.flags).filter((f) => f.type === "time_velocity");
      expect(timeVel).toHaveLength(0);
    });

    it("does NOT flag 10 tx spread over 5 minutes (outside window)", async () => {
      const base = new Date("2026-04-27T01:25:00Z").getTime();
      const window: MinimalTx[] = [];
      for (let i = 0; i < 10; i++) {
        window.push({
          _id: new ObjectId(),
          type: "bond_purchase",
          turn: 387,
          createdAt: new Date(base + i * 60_000), // 1 min apart
          subjectType: "character",
          subjectId: charId,
          amount: -1_000_000,
          currencyCode: "USD",
        });
      }
      const db = setupDb(window);
      await runFinancialSuspectScan(db as never, 387);
      const flagged = findFlagOps(db);
      const timeVel = flagged.flatMap((o) => o.flags).filter((f) => f.type === "time_velocity");
      expect(timeVel).toHaveLength(0);
    });
  });

  describe("same_price_wash", () => {
    it("flags buy+sell on same corp at identical price within 5 minutes", async () => {
      const base = new Date("2026-04-27T01:01:00Z").getTime();
      const window: MinimalTx[] = [
        {
          _id: new ObjectId(),
          type: "stock_trade_sell",
          turn: 387,
          createdAt: new Date(base),
          subjectType: "character",
          subjectId: charId,
          amount: 141_689_193,
          currencyCode: "USD",
          meta: { corporationId: corpId.toString(), pricePerShare: 14.168919 },
        },
        {
          _id: new ObjectId(),
          type: "stock_trade_buy",
          turn: 387,
          createdAt: new Date(base + 3 * 60_000), // 3 min later
          subjectType: "character",
          subjectId: charId,
          amount: -141_689_193,
          currencyCode: "USD",
          meta: { corporationId: corpId.toString(), pricePerShare: 14.168919 },
        },
      ];
      const db = setupDb(window);
      await runFinancialSuspectScan(db as never, 387);
      const flagged = findFlagOps(db);
      const washes = flagged.flatMap((o) => o.flags).filter((f) => f.type === "same_price_wash");
      expect(washes).toHaveLength(2);
    });

    it("does NOT flag when buy/sell prices differ", async () => {
      const base = new Date("2026-04-27T01:01:00Z").getTime();
      const window: MinimalTx[] = [
        {
          _id: new ObjectId(),
          type: "stock_trade_sell",
          turn: 387,
          createdAt: new Date(base),
          subjectType: "character",
          subjectId: charId,
          amount: 141_689_193,
          currencyCode: "USD",
          meta: { corporationId: corpId.toString(), pricePerShare: 14.169 },
        },
        {
          _id: new ObjectId(),
          type: "stock_trade_buy",
          turn: 387,
          createdAt: new Date(base + 60_000),
          subjectType: "character",
          subjectId: charId,
          amount: -141_689_000,
          currencyCode: "USD",
          meta: { corporationId: corpId.toString(), pricePerShare: 16.294 },
        },
      ];
      const db = setupDb(window);
      await runFinancialSuspectScan(db as never, 387);
      const flagged = findFlagOps(db);
      const washes = flagged.flatMap((o) => o.flags).filter((f) => f.type === "same_price_wash");
      expect(washes).toHaveLength(0);
    });

    it("does NOT flag pair more than 5 minutes apart", async () => {
      const base = new Date("2026-04-27T01:01:00Z").getTime();
      const window: MinimalTx[] = [
        {
          _id: new ObjectId(),
          type: "stock_trade_sell",
          turn: 387,
          createdAt: new Date(base),
          subjectType: "character",
          subjectId: charId,
          amount: 100_000,
          currencyCode: "USD",
          meta: { corporationId: corpId.toString(), pricePerShare: 5 },
        },
        {
          _id: new ObjectId(),
          type: "stock_trade_buy",
          turn: 387,
          createdAt: new Date(base + 10 * 60_000), // 10 min later
          subjectType: "character",
          subjectId: charId,
          amount: -100_000,
          currencyCode: "USD",
          meta: { corporationId: corpId.toString(), pricePerShare: 5 },
        },
      ];
      const db = setupDb(window);
      await runFinancialSuspectScan(db as never, 387);
      const flagged = findFlagOps(db);
      const washes = flagged.flatMap((o) => o.flags).filter((f) => f.type === "same_price_wash");
      expect(washes).toHaveLength(0);
    });
  });

  describe("cash_mismatch", () => {
    it("flags the most-recent tx when actual cash delta exceeds logged net by > $1M", async () => {
      const window: MinimalTx[] = [
        {
          _id: new ObjectId(),
          type: "bond_purchase",
          turn: 387,
          createdAt: new Date("2026-04-27T01:00:00Z"),
          subjectType: "character",
          subjectId: charId,
          amount: -1_000_000, // logged 1M debit (in USD = anchor at rate 1)
          currencyCode: "USD",
        },
        {
          _id: new ObjectId(),
          type: "bond_purchase",
          turn: 387,
          createdAt: new Date("2026-04-27T01:30:00Z"),
          subjectType: "character",
          subjectId: charId,
          amount: -1_000_000, // logged another 1M debit; total -2M
          currencyCode: "USD",
        },
      ];
      // portfolioHistory: cash dropped only $100k, but logged net is -$2M.
      // gap = -100k - (-2_000_000) = +1.9M phantom inflow.
      const snapshots = [
        { characterId: charId, turn: 386, cashValue: 1_000_000, totalValue: 1_000_000 },
        { characterId: charId, turn: 388, cashValue: 900_000, totalValue: 900_000 },
      ];
      const rates = [{ currencyCode: "USD", rate: 1 }];

      const db = setupDb(window, snapshots, rates);
      await runFinancialSuspectScan(db as never, 388);

      const flagged = findFlagOps(db);
      const mismatch = flagged
        .flatMap((o) => o.flags.map((f) => ({ id: o.id, ...f })))
        .filter((f) => f.type === "cash_mismatch");
      expect(mismatch).toHaveLength(1);
      // Most-recent tx is the second one — verify the flag landed on the
      // last createdAt entry, not the first.
      expect(mismatch[0].id).toBe(window[1]._id.toString());
    });

    it("does NOT flag when gap is below the $1M threshold", async () => {
      const window: MinimalTx[] = [
        {
          _id: new ObjectId(),
          type: "fund_credit",
          turn: 387,
          createdAt: new Date("2026-04-27T01:00:00Z"),
          subjectType: "character",
          subjectId: charId,
          amount: 100_000,
          currencyCode: "USD",
        },
      ];
      // Actual cash went up by $99k, logged $100k → gap −$1k. Way under threshold.
      const snapshots = [
        { characterId: charId, turn: 386, cashValue: 0, totalValue: 0 },
        { characterId: charId, turn: 388, cashValue: 99_000, totalValue: 99_000 },
      ];
      const rates = [{ currencyCode: "USD", rate: 1 }];

      const db = setupDb(window, snapshots, rates);
      await runFinancialSuspectScan(db as never, 388);

      const flagged = findFlagOps(db);
      const mismatch = flagged.flatMap((o) => o.flags).filter((f) => f.type === "cash_mismatch");
      expect(mismatch).toHaveLength(0);
    });

    it("does NOT flag when fewer than 2 snapshots exist (not reconcilable)", async () => {
      const window: MinimalTx[] = [
        {
          _id: new ObjectId(),
          type: "bond_purchase",
          turn: 387,
          createdAt: new Date("2026-04-27T01:00:00Z"),
          subjectType: "character",
          subjectId: charId,
          amount: -10_000_000,
          currencyCode: "USD",
        },
      ];
      // Single snapshot → can't compute delta → skip silently.
      const snapshots = [{ characterId: charId, turn: 388, cashValue: 0, totalValue: 0 }];
      const rates = [{ currencyCode: "USD", rate: 1 }];

      const db = setupDb(window, snapshots, rates);
      await runFinancialSuspectScan(db as never, 388);

      const flagged = findFlagOps(db);
      const mismatch = flagged.flatMap((o) => o.flags).filter((f) => f.type === "cash_mismatch");
      expect(mismatch).toHaveLength(0);
    });
  });

  it("fails fast when the suspect scan exceeds its runtime budget", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    const originalSetImmediate = globalThis.setImmediate;
    try {
      let currentNow = 0;
      nowSpy.mockImplementation(() => currentNow);
      vi.stubGlobal("setImmediate", ((
        callback: (...args: unknown[]) => void,
        ...args: unknown[]
      ) => {
        currentNow = 95_000;
        return originalSetImmediate(callback as (...args: unknown[]) => void, ...args);
      }) as typeof setImmediate);

      const window: MinimalTx[] = Array.from({ length: 250 }, (_, index) => ({
        _id: new ObjectId(),
        type: "bond_purchase",
        turn: 387,
        createdAt: new Date(`2026-04-27T01:${String(index % 60).padStart(2, "0")}:00Z`),
        subjectType: "character",
        subjectId: charId,
        amount: -1_000_000,
        currencyCode: "USD",
      }));
      const db = setupDb(window);

      await expect(runFinancialSuspectScan(db as never, 387)).rejects.toThrow(
        /financialSuspectScan exceeded 90s budget/
      );
      expect(db.collectionMocks.financialTxLog.bulkWrite).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      nowSpy.mockRestore();
    }
  });

  it("normalizes legacy null suspectFlags before pushing new flags", async () => {
    const base = new Date("2026-04-27T01:25:00Z").getTime();
    const window: MinimalTx[] = Array.from({ length: 10 }, (_, index) => ({
      _id: new ObjectId(),
      type: "bond_purchase",
      turn: 387,
      createdAt: new Date(base + index * 5000),
      subjectType: "character",
      subjectId: charId,
      amount: -1_000_000,
      currencyCode: "USD",
      suspectFlags: index === 0 ? null : undefined,
    }));
    const db = setupDb(window);

    await runFinancialSuspectScan(db as never, 387);

    expect(db.collectionMocks.financialTxLog.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = db.collectionMocks.financialTxLog.updateMany.mock.calls[0];
    expect(filter).toEqual({
      turn: { $gte: 382 },
      $expr: { $eq: [{ $isArray: "$suspectFlags" }, false] },
    });
    expect(update).toEqual([{ $set: { suspectFlags: [] } }]);
    expect(db.collectionMocks.financialTxLog.bulkWrite).toHaveBeenCalled();
  });
});
