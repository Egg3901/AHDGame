/**
 * Batched NPP redemption payouts pay exactly what single payouts pay, through
 * one receipt, and converge after a refused credit or an interrupted pass.
 */
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { countRoundTrips } from "@/lib/test-utils/roundTripCounter";
import type { IndexFund, IndexFundRedemptionQueueEntry } from "@/lib/db/types";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { processQueuedRedemptions } from "./fundCron";
import { isBatchablePayout } from "./queuedPayoutBatch";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const T0 = new Date("2000-01-01T00:00:00Z");
const NPPS = 10;
const PER_NPP = 3;

/**
 * Ten NPPs with three queued requests each, the shape NPP rebalancing leaves.
 * `burned` false routes every entry through the single-payout path (the
 * legacy unit-supply guard), which pays the same cash.
 */
function world(opts: { burned: boolean; cash: number }) {
  const memory = createInMemoryDb();
  const fundId = new ObjectId();
  const fund: IndexFund = {
    _id: fundId,
    slug: "batch-test",
    name: "Batch Fund",
    tickerSymbol: "BTF",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 1_000_000,
    reserveUnits: 0,
    cashAnchor: opts.cash,
    targetConstituents: [],
    holdings: [],
    createdAt: T0,
    updatedAt: T0,
  };
  const npps = Array.from({ length: NPPS }, (_, i) => ({
    _id: new ObjectId(),
    countryId: "US",
    name: `NPP ${i}`,
    nppInvestmentCashAnchor: 7,
  }));
  const entries: IndexFundRedemptionQueueEntry[] = [];
  for (let k = 0; k < PER_NPP; k++)
    for (const [i, npp] of npps.entries()) {
      const units = 1 + ((i + k) % 4);
      entries.push({
        _id: new ObjectId(),
        fundId,
        holderKind: "npp",
        nppId: npp._id,
        units,
        requestedNavAnchor: 100,
        requestedAmountAnchor: units * 100,
        paidAmountAnchor: 0,
        status: "queued",
        ...(opts.burned ? { unitsBurnedAtRequest: true } : {}),
        createdAt: new Date(T0.getTime() + entries.length),
        updatedAt: new Date(T0.getTime() + entries.length),
      });
    }
  memory.seed("indexFunds", [{ ...fund }]);
  memory.seed(
    "indexFundRedemptionQueue",
    entries.map((e) => ({ ...e }))
  );
  memory.seed(
    "npps",
    npps.map((n) => ({ ...n }))
  );
  memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 7 }]);
  return { memory, db: memory as unknown as Db, fund, fundId, npps, entries };
}

type World = ReturnType<typeof world>;

async function outcome(w: World) {
  const queue = await w.db
    .collection<IndexFundRedemptionQueueEntry>("indexFundRedemptionQueue")
    .find({})
    .toArray();
  const npps = await w.db.collection("npps").find({}).toArray();
  const fund = await w.db.collection<IndexFund>("indexFunds").findOne({ _id: w.fundId });
  return {
    fundCash: fund!.cashAnchor,
    entries: w.entries.map((e) => {
      const row = queue.find((q) => q._id.equals(e._id))!;
      return [row.status, row.units, row.paidAmountAnchor];
    }),
    npps: w.npps.map((n) => npps.find((r) => r._id.equals(n._id))?.nppInvestmentCashAnchor),
  };
}

async function pass(w: World, turn: number) {
  const fund = await w.db.collection<IndexFund>("indexFunds").findOne({ _id: w.fundId });
  return processQueuedRedemptions(w.db, fund!, false, turn);
}

describe("batched queued NPP payouts", () => {
  it("only batches NPP claims whose units left the fund at request", () => {
    const [entry] = world({ burned: true, cash: 1 }).entries;
    expect(isBatchablePayout(entry)).toBe(true);
    expect(isBatchablePayout({ ...entry, unitsBurnedAtRequest: undefined })).toBe(false);
    expect(
      isBatchablePayout({ ...entry, holderKind: "character", characterId: new ObjectId() })
    ).toBe(false);
  });

  it.each([
    ["ample cash", 100_000],
    ["pro-rata cash", 3_700],
  ])("pays exactly what single payouts pay with %s", async (_label, cash) => {
    const single = world({ burned: false, cash });
    const batched = world({ burned: true, cash });
    // Both queues hold the same requests in the same order.
    const singleTrips = countRoundTrips(single.memory);
    await pass(single, 7);
    const singleCount = singleTrips.total();
    const batchTrips = countRoundTrips(batched.memory);
    await pass(batched, 7);
    const batchCount = batchTrips.total();

    const a = await outcome(single);
    const b = await outcome(batched);
    expect(b.fundCash).toBeCloseTo(a.fundCash, 9);
    expect(b.entries).toEqual(a.entries);
    b.npps.forEach((value, i) => expect(value).toBeCloseTo(a.npps[i]!, 9));
    // Something was paid, and with tight cash some entries were only part paid.
    expect(b.entries.some(([, , paid]) => Number(paid) > 0)).toBe(true);
    // Cash is conserved between the fund and the NPPs.
    const total = (o: typeof b) => o.fundCash + o.npps.reduce((s, v) => s + Number(v), 0);
    expect(total(b)).toBeCloseTo(cash + NPPS * 7, 6);
    // One receipt instead of one per claim, at a fraction of the round trips.
    const moves = await batched.db.collection(MONEY_MOVE_COLLECTION).find({}).toArray();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: "fund_queued_redemption_batch", status: "applied" });
    expect(batchCount).toBeLessThan(singleCount / 3);
    // Every paid claim still has its own receipts.
    const paid = b.entries.filter(([, , amount]) => Number(amount) > 0).length;
    expect(batched.memory.collection("indexFundTransactions").docs).toHaveLength(paid);
    expect(batched.memory.collection("financialTxLog").docs).toHaveLength(paid);
    expect(batched.memory.collection("actionAuditLog").docs).toHaveLength(paid);
    expect(batched.memory.collection("ledgerEntries").docs).toHaveLength(paid * 2);
  });

  it("returns refused credits to the fund and keeps those claims owed", async () => {
    const w = world({ burned: true, cash: 100_000 });
    const gone = w.npps.slice(0, 2).map((n) => n._id);
    const queue = w.memory.collection("indexFundRedemptionQueue");
    const write = queue.bulkWrite.bind(queue);
    let deleted = false;
    queue.bulkWrite = async (...args: Parameters<typeof write>) => {
      const result = await write(...args);
      const ops = args[0] as { updateOne?: { update: { $set?: { payoutBatch?: unknown } } } }[];
      if (!deleted && ops.some((op) => op.updateOne?.update.$set?.payoutBatch)) {
        deleted = true;
        // Two NPPs disappear after their claims were frozen into the batch.
        await w.db.collection("npps").deleteMany({ _id: { $in: gone } });
      }
      return result;
    };
    const paidCount = await pass(w, 7);
    expect(deleted).toBe(true);
    expect(paidCount).toBe((NPPS - 2) * PER_NPP);

    const rows = await w.db
      .collection<IndexFundRedemptionQueueEntry & { payoutBatch?: unknown }>(
        "indexFundRedemptionQueue"
      )
      .find({})
      .toArray();
    for (const row of rows) {
      if (gone.some((id) => id.equals(row.nppId!))) {
        expect(row).toMatchObject({ status: "queued", paidAmountAnchor: 0 });
        expect(row.payoutBatch).toBeUndefined();
      } else expect(row).toMatchObject({ status: "paid", units: 0 });
    }
    const paidOut = rows.reduce((s, r) => s + r.paidAmountAnchor, 0);
    const fund = await w.db.collection<IndexFund>("indexFunds").findOne({ _id: w.fundId });
    expect(fund!.cashAnchor).toBeCloseTo(100_000 - paidOut, 6);
    const npps = await w.db.collection("npps").find({}).toArray();
    expect(npps.reduce((s, n) => s + n.nppInvestmentCashAnchor, 0)).toBeCloseTo(
      (NPPS - 2) * 7 + paidOut,
      6
    );
    const moves = await w.db.collection(MONEY_MOVE_COLLECTION).find({}).toArray();
    const original = moves.find((m) => m.kind === "fund_queued_redemption_batch");
    const refund = moves.find((m) => m.kind === "fund_redemption_refund");
    expect(original).toMatchObject({ status: "rejected", compensationKey: refund!._id });
    expect(refund).toMatchObject({ status: "applied" });
    // Receipts only for claims that were paid.
    expect(w.memory.collection("indexFundTransactions").docs).toHaveLength(paidCount);
    expect(w.memory.collection("financialTxLog").docs).toHaveLength(paidCount);

    // A later pass leaves the orphaned claims owed and pays nothing twice.
    expect(await pass(w, 8)).toBe(0);
    expect(w.memory.collection("indexFundTransactions").docs).toHaveLength(paidCount);
  });

  it("releases a batch that never reached the journal only in a later turn, then pays once", async () => {
    const w = world({ burned: true, cash: 100_000 });
    const moves = w.memory.collection(MONEY_MOVE_COLLECTION);
    const insert = moves.insertOne.bind(moves);
    let failed = false;
    moves.insertOne = async (...args: Parameters<typeof insert>) => {
      if (!failed) {
        failed = true;
        throw new Error("Synthetic crash before the batch receipt was written");
      }
      return insert(...args);
    };
    await expect(pass(w, 7)).rejects.toThrow("Synthetic crash");
    const frozen = await w.db
      .collection("indexFundRedemptionQueue")
      .countDocuments({ status: "processing", payoutBatch: { $exists: true } });
    expect(frozen).toBe(NPPS * PER_NPP);

    // The same turn may still have the original pass running: leave its claims.
    expect(await pass(w, 7)).toBe(0);
    // A later turn returns them to the queue and pays each exactly once.
    expect(await pass(w, 8)).toBe(NPPS * PER_NPP);
    const rows = await w.db
      .collection<IndexFundRedemptionQueueEntry>("indexFundRedemptionQueue")
      .find({})
      .toArray();
    expect(rows.every((r) => r.status === "paid" && r.units === 0)).toBe(true);
    expect(w.memory.collection("indexFundTransactions").docs).toHaveLength(NPPS * PER_NPP);
    const paidOut = rows.reduce((s, r) => s + r.paidAmountAnchor, 0);
    const fund = await w.db.collection<IndexFund>("indexFunds").findOne({ _id: w.fundId });
    expect(fund!.cashAnchor + paidOut).toBeCloseTo(100_000, 6);
  });
});
