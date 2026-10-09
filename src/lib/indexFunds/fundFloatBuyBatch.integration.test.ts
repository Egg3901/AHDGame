/**
 * Batched fund float purchases (#2692): one recoverable settlement per fund
 * rebalance instead of one per trade.
 *
 * Every test runs the real settlement journal against the in-memory db. The
 * batch must fill, price and round exactly like the sequential path, conserve
 * money, resume without double posting after an interruption at each step, fall
 * back to sequential execution when a concurrent change claims the epoch first,
 * and cost far fewer round trips.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { countRoundTrips } from "@/lib/test-utils/roundTripCounter";
import { getDb } from "@/lib/mongodb";
import { loadEquityPoolsByCurrency } from "@/lib/equities/marketPool";
import {
  executeFundShareBuy,
  executeFundShareBuys,
  type FundShareBuyLeg,
} from "./fundFloatBuyExecution";
import { recoverAllFundFloatSettlements, type SettlementFund } from "./fundFloatSettlement";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
void MongoClient;

const TURN = 7;
const NOW = new Date("2000-01-01T00:00:00Z");

type Options = { corps?: number; pool?: boolean; cash?: number };

function fixture({ corps: corpCount = 4, pool = false, cash = 100_000 }: Options = {}) {
  const memory = createInMemoryDb();
  const db = memory as unknown as Db;
  const fundId = new ObjectId();
  const corps = Array.from({ length: corpCount }, (_, i) => ({
    _id: new ObjectId(),
    name: `Issuer ${i}`,
    type: "technology" as const,
    countryId: "US" as const,
    liquidCurrencyCode: "USD" as const,
    shareBuybackMode: "instant" as const,
    sharePrice: 40 + i * 7.5,
    fundamentalSharePrice: 40 + i * 7.5,
    totalShares: 10_000,
    publicFloat: 1000,
    liquidCapital: 500,
    shareholders: [] as unknown[],
    shareIssuanceProceeds: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }));
  const fund: IndexFund = {
    _id: fundId,
    slug: "synthetic",
    name: "Synthetic Fund",
    tickerSymbol: "RFX",
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 100,
    reserveUnits: 0,
    cashAnchor: cash,
    holdings: [],
    targetConstituents: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
  memory.seed("indexFunds", [{ ...fund }]);
  memory.seed("corporations", corps);
  if (pool)
    memory.seed("equityMarketPools", [
      {
        _id: "USD",
        cashLocal: 50_000,
        targetCashLocal: 50_000,
        lifetime: { purchasesIn: 0 },
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  memory.seed("gameConfig", [
    { _id: "default", ledgerShadow: true, auditLog: true, indexFundsMode: "full" },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN - 1 }]);
  vi.mocked(getDb).mockResolvedValue(db);
  const legs: FundShareBuyLeg[] = corps.map((corp, i) => ({
    corp: corp as never,
    shares: 3 + i,
    referencePriceAnchor: corp.sharePrice,
  }));
  return { memory, db, fundId, corps, fund, legs };
}
type Fx = ReturnType<typeof fixture>;

const run = {
  async batch(f: Fx) {
    const pools = await loadEquityPoolsByCurrency(f.db);
    return executeFundShareBuys(f.db, f.fund as SettlementFund, f.legs, TURN, { pools });
  },
  async sequential(f: Fx) {
    const pools = await loadEquityPoolsByCurrency(f.db);
    const batch = { pools };
    let buys = 0;
    for (const leg of f.legs)
      if (
        (
          await executeFundShareBuy(
            f.db,
            f.fund as SettlementFund,
            leg.corp,
            leg.shares,
            leg.referencePriceAnchor,
            TURN,
            batch
          )
        ).ok
      )
        buys++;
    return { buys };
  },
};

/** Everything economically observable, with ids and settlement keys stripped. */
async function observe(f: Fx) {
  const fund = (await f.db.collection("indexFunds").findOne({ _id: f.fundId })) as never as Record<
    string,
    any
  >;
  const corps = await f.db.collection("corporations").find({}).toArray();
  const pools = await f.db.collection("equityMarketPools").find({}).toArray();
  const sum = async (collection: string, pick: (row: Record<string, any>) => number) =>
    Math.round(
      (await f.db.collection(collection).find({}).toArray()).reduce(
        (total, row) => total + pick(row as Record<string, any>),
        0
      ) * 1e6
    ) / 1e6;
  return {
    cash: fund.cashAnchor,
    holdings: [...fund.holdings]
      .map((h: any) => [
        String(h.corporationId),
        h.shares,
        h.avgCostPerShareAnchor,
        h.lastValueAnchor,
      ])
      .sort(),
    corps: corps
      .map((c: any) => [
        String(c._id),
        c.liquidCapital,
        c.publicFloat,
        c.shareIssuanceProceeds,
        (c.shareholders ?? []).map((s: any) => [String(s.fundId), s.shares, s.avgCostPerShare]),
      ])
      .sort(),
    pools: pools.map((p: any) => [p._id, p.cashLocal, p.lifetime?.purchasesIn]),
    receipts: {
      fundTx: await f.db.collection("indexFundTransactions").countDocuments(),
      financial: await f.db.collection("financialTxLog").countDocuments(),
      ledger: await f.db.collection("ledgerEntries").countDocuments(),
      audit: await f.db.collection("actionAuditLog").countDocuments(),
      history: await f.db.collection("shareTradeHistory").countDocuments(),
    },
    fundTxAmount: await sum("indexFundTransactions", (r) => r.amountAnchor ?? 0),
    financialAmount: await sum("financialTxLog", (r) => r.amount ?? 0),
    historyShares: await sum("shareTradeHistory", (r) => r.shares ?? 0),
  };
}

async function expectConserved(f: Fx, opening: Awaited<ReturnType<typeof collectBalances>>) {
  const closing = await collectBalances(f.db);
  const entries = await f.db
    .collection<LedgerEntry>("ledgerEntries")
    .find({ turn: TURN })
    .toArray();
  const report = reconcileLedger({
    turn: TURN,
    openingBalances: opening,
    closingBalances: closing,
    entries,
  });
  expect(report.stockVsFlow.divergentCount).toBe(0);
  expect(report.trialBalance.unbalancedCount).toBe(0);
  expect(report.unattributed).toEqual([]);
}

describe.each([
  ["issuer-funded", false],
  ["finite pool", true],
] as const)("batched float buys (%s)", (_name, pool) => {
  it("fills, prices and rounds exactly like the sequential path", async () => {
    const a = fixture({ pool });
    const b = fixture({ pool });
    const opening = await collectBalances(a.db);
    expect((await run.batch(a)).buys).toBe(4);
    expect((await run.sequential(b)).buys).toBe(4);
    const batched = await observe(a);
    const sequential = await observe(b);
    // Ids differ between the two fixtures, so compare shapes by position.
    const strip = (o: Awaited<ReturnType<typeof observe>>) => ({
      ...o,
      holdings: o.holdings.map((h) => h.slice(1)),
      corps: o.corps.map((c) => [c[1], c[2], c[3], (c[4] as unknown[][]).map((s) => s.slice(1))]),
    });
    // Summation order differs between the paths, so compare money to the cent
    // rather than to the last float bit.
    const settle = (value: unknown): unknown =>
      JSON.parse(
        JSON.stringify(value, (_k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v))
      );
    expect(settle(strip(batched))).toEqual(settle(strip(sequential)));
    await expectConserved(a, opening);
  });

  it("settles under one journal key with grouped receipts", async () => {
    const f = fixture({ pool });
    await run.batch(f);
    expect(await f.db.collection("bankMoneyMoves").countDocuments()).toBe(1);
    const fund = (await f.db
      .collection("indexFunds")
      .findOne({ _id: f.fundId })) as never as SettlementFund;
    expect(fund.floatSettlementPlan).toMatchObject({ state: "completed", direction: "buy" });
    expect(fund.floatSettlementGeneration).toBe(1);
    expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(4);
  });

  it.each(["fund-cash", "counterparty-cash", "custody"])(
    "resumes after a lost %s acknowledgement without double posting",
    async (boundary) => {
      const clean = fixture({ pool });
      await run.batch(clean);
      const expected = await observe(clean);

      const f = fixture({ pool });
      const opening = await collectBalances(f.db);
      const name =
        boundary === "fund-cash"
          ? "indexFunds"
          : boundary === "custody"
            ? "corporations"
            : pool
              ? "equityMarketPools"
              : "corporations";
      const target = f.memory.collection(name);
      const write = target.updateOne.bind(target);
      let interrupted = false;
      target.updateOne = async (...args: Parameters<typeof write>) => {
        const result = await write(...args);
        const update = args[1] as { $inc?: Record<string, number>; $set?: Record<string, unknown> };
        const hit =
          boundary === "fund-cash"
            ? !!update.$inc?.cashAnchor
            : boundary === "counterparty-cash"
              ? !!(update.$inc?.liquidCapital ?? update.$inc?.cashLocal)
              : Array.isArray(update.$set?.shareholders);
        if (!interrupted && hit && result.matchedCount) {
          interrupted = true;
          throw new Error("Synthetic acknowledgement lost");
        }
        return result;
      };
      await run.batch(f).catch(() => undefined);
      expect(interrupted).toBe(true);
      for (let i = 0; i < 3; i++) await recoverAllFundFloatSettlements(f.db);
      const strip = (o: Awaited<ReturnType<typeof observe>>) => ({
        ...o,
        holdings: o.holdings.map((h) => h.slice(1)),
        corps: o.corps.map((c) => [c[1], c[2], c[3], (c[4] as unknown[][]).map((s) => s.slice(1))]),
      });
      expect(strip(await observe(f))).toEqual(strip(expected));
      await expectConserved(f, opening);
    }
  );

  it.each([
    "indexFundTransactions",
    "financialTxLog",
    "ledgerEntries",
    "actionAuditLog",
    "shareTradeHistory",
  ])("resumes after a lost %s receipt batch acknowledgement", async (collection) => {
    const clean = fixture({ pool });
    await run.batch(clean);
    const expected = await observe(clean);

    const f = fixture({ pool });
    const opening = await collectBalances(f.db);
    const target = f.memory.collection(collection);
    const write = target.insertMany.bind(target);
    let interrupted = false;
    target.insertMany = async (...args: Parameters<typeof write>) => {
      const result = await write(...args);
      if (!interrupted) {
        interrupted = true;
        throw new Error("Synthetic receipt acknowledgement lost");
      }
      return result;
    };
    await run.batch(f).catch(() => undefined);
    expect(interrupted).toBe(true);
    for (let i = 0; i < 3; i++) await recoverAllFundFloatSettlements(f.db);
    expect((await observe(f)).receipts).toEqual(expected.receipts);
    expect((await observe(f)).financialAmount).toBe(expected.financialAmount);
    await expectConserved(f, opening);
  });

  it("resumes a partially written receipt batch without duplicating the rows that landed", async () => {
    const f = fixture({ pool });
    const target = f.memory.collection("financialTxLog");
    const write = target.insertMany.bind(target);
    let interrupted = false;
    target.insertMany = async (docs: Record<string, unknown>[]) => {
      if (!interrupted) {
        interrupted = true;
        await write(docs.slice(0, 2));
        throw new Error("Crash after the first rows landed");
      }
      return write(docs);
    };
    await run.batch(f).catch(() => undefined);
    for (let i = 0; i < 3; i++) await recoverAllFundFloatSettlements(f.db);
    const clean = fixture({ pool });
    await run.batch(clean);
    expect((await observe(f)).receipts).toEqual((await observe(clean)).receipts);
  });

  it("reverses a refused batch completely, then fills the legs one at a time", async () => {
    const f = fixture({ pool });
    const opening = await collectBalances(f.db);
    const target = f.memory.collection("corporations");
    const write = target.updateOne.bind(target);
    let refused = false;
    target.updateOne = async (...args: Parameters<typeof write>) => {
      const update = args[1] as { $set?: { shareholders?: unknown } };

      if (
        !refused &&
        Array.isArray(update.$set?.shareholders) &&
        JSON.stringify(args[0]).includes(String(f.corps[2]._id))
      ) {
        refused = true;
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      return write(...args);
    };
    const result = await run.batch(f);
    expect(refused).toBe(true);
    expect(result.buys).toBe(4);
    const seen = await observe(f);
    expect(seen.receipts.fundTx).toBe(4);
    expect(seen.holdings).toHaveLength(4);
    await expectConserved(f, opening);
  });
});

describe("batched float buys: concurrency and bounds", () => {
  it("falls back to sequential fills when a concurrent change wins the epoch", async () => {
    const f = fixture();
    const opening = await collectBalances(f.db);
    const funds = f.memory.collection("indexFunds");
    const claim = funds.findOneAndUpdate.bind(funds);
    let raced = false;
    funds.findOneAndUpdate = async (...args: Parameters<typeof claim>) => {
      if (!raced) {
        raced = true;
        // A player subscription lands between the batch's read and its claim.
        await funds.updateOne({ _id: f.fundId }, { $inc: { cashAnchor: 10 } });
      }
      return claim(...args);
    };
    expect((await run.batch(f)).buys).toBe(4);
    expect(raced).toBe(true);
    const fund = await f.db.collection("indexFunds").findOne({ _id: f.fundId });
    expect(fund).toMatchObject({ holdings: expect.any(Array) });
    expect((fund as never as IndexFund).cashAnchor).toBeCloseTo(100_000 + 10 - spend(f), 6);
    expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(4);
    void opening;
  });

  it("refuses trades the fund cannot afford exactly as the sequential path does", async () => {
    const tight = { cash: 600 };
    const a = fixture(tight);
    const b = fixture(tight);
    const batched = await run.batch(a);
    const sequential = await run.sequential(b);
    expect(batched.buys).toBe(sequential.buys);
    expect(batched.buys).toBeGreaterThan(0);
    expect(batched.buys).toBeLessThan(4);
    expect((await observe(a)).cash).toBeCloseTo((await observe(b)).cash, 9);
  });

  it("splits an oversized list into several recoverable batches", async () => {
    const f = fixture({ corps: 30, cash: 10_000_000 });
    expect((await run.batch(f)).buys).toBe(30);
    expect(await f.db.collection("bankMoneyMoves").countDocuments()).toBe(2);
    expect((await observe(f)).receipts.fundTx).toBe(30);
  });

  it("uses a small, fixed number of round trips per batch", async () => {
    const one = fixture({ corps: 12, pool: true, cash: 10_000_000 });
    const trips = countRoundTrips(one.memory);
    trips.reset();
    await run.batch(one);
    const batched = trips.total();

    const seq = fixture({ corps: 12, pool: true, cash: 10_000_000 });
    const seqTrips = countRoundTrips(seq.memory);
    seqTrips.reset();
    await run.sequential(seq);
    const sequential = seqTrips.total();

    expect(batched).toBeLessThan(sequential / 2.5);
    expect(batched).toBeLessThan(12 * 14);
  });
});

function spend(f: Fx): number {
  return f.legs.reduce((sum, leg) => sum + leg.shares * leg.corp.sharePrice, 0);
}

export type { InMemoryDb };
