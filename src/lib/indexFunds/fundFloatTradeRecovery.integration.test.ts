/** Actual fund float entry points preserve cash, inventory and receipts on replay. */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { executeFundShareBuy, type FundShareBuyBatch } from "./fundCron";
import {
  sellFundHoldingShares,
  sellFundHoldingsForRedemptionCash,
} from "./fundRedemptionLiquidity";
import { recoverAllFundFloatSettlements, type SettlementFund } from "./fundFloatSettlement";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

function fixture(direction: "buy" | "sell") {
  const memory = createInMemoryDb(),
    db = memory as unknown as Db;
  const fundId = new ObjectId(),
    corpId = new ObjectId(),
    now = new Date("2000-01-01T00:00:00Z");
  const selling = direction === "sell";
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
    cashAnchor: selling ? 50 : 1000,
    holdings: selling
      ? [{ corporationId: corpId, shares: 10, avgCostPerShareAnchor: 100, lastValueAnchor: 1000 }]
      : [],
    targetConstituents: [],
    createdAt: now,
    updatedAt: now,
  };
  const corp = {
    _id: corpId,
    name: "Synthetic issuer",
    type: "technology" as const,
    countryId: "US" as const,
    liquidCurrencyCode: "USD" as const,
    shareBuybackMode: "instant" as const,
    sharePrice: 100,
    fundamentalSharePrice: 100,
    totalShares: 10000,
    publicFloat: selling ? 990 : 1000,
    liquidCapital: selling ? 1000 : 50,
    shareholders: selling ? [{ fundId, shares: 10, avgCostPerShare: 100 }] : [],
    shareIssuanceProceeds: 0,
    createdAt: now,
    updatedAt: now,
  };
  memory.seed("indexFunds", [{ ...fund }]);
  memory.seed("corporations", [corp]);
  memory.seed("gameConfig", [
    { _id: "default", ledgerShadow: true, auditLog: true, indexFundsMode: "full" },
  ]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 7 }]);
  vi.mocked(getDb).mockResolvedValue(db);
  const execute = () =>
    selling
      ? sellFundHoldingShares(db, fund, corpId, 5, { turn: 7 })
      : executeFundShareBuy(db, fund, corp, 5, 100, 7, { pools: new Map() });
  return { memory, db, fundId, corpId, fund, corp, direction, execute };
}
async function assertFinal(f: ReturnType<typeof fixture>) {
  const fund = await f.db.collection<SettlementFund>("indexFunds").findOne({ _id: f.fundId });
  const corp = await f.db.collection("corporations").findOne({ _id: f.corpId });
  const selling = f.direction === "sell";
  expect(fund!.cashAnchor + corp!.liquidCapital).toBe(1050);
  expect(fund).toMatchObject({
    cashAnchor: selling ? 550 : 500,
    holdings: [{ corporationId: f.corpId, shares: 5 }],
    floatSettlementPlan: { state: "completed" },
  });
  expect(corp).toMatchObject({
    publicFloat: 995,
    liquidCapital: selling ? 500 : 550,
    shareholders: [{ fundId: f.fundId, shares: 5 }],
  });
  expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(1);
  expect(await f.db.collection("financialTxLog").countDocuments()).toBe(2);
  expect(await f.db.collection("ledgerEntries").countDocuments()).toBe(2);
  expect(await f.db.collection("actionAuditLog").countDocuments()).toBe(2);
  expect(await f.db.collection("shareTradeHistory").countDocuments()).toBe(1);
}

describe.each(["buy", "sell"] as const)("actual fund float %s recovery", (direction) => {
  it("settles the actual entry point with zero accounting residue", async () => {
    const f = fixture(direction),
      opening = await collectBalances(f.db);
    await f.execute();
    await assertFinal(f);
    const closing = await collectBalances(f.db);
    const entries = await f.db.collection<LedgerEntry>("ledgerEntries").find({ turn: 7 }).toArray();
    const report = reconcileLedger({
      turn: 7,
      openingBalances: opening,
      closingBalances: closing,
      entries,
    });
    expect(report.stockVsFlow.divergentCount).toBe(0);
    expect(report.trialBalance.unbalancedCount).toBe(0);
    expect(report.unattributed).toEqual([]);
  });
  it.each(["fund-cash", "counterparty-cash", "custody"])(
    "recovers a lost %s acknowledgement",
    async (boundary) => {
      const f = fixture(direction),
        name = boundary === "fund-cash" ? "indexFunds" : "corporations";
      const target = f.memory.collection(name),
        write = target.updateOne.bind(target);
      let interrupted = false;
      target.updateOne = async (...args: Parameters<typeof write>) => {
        const result = await write(...args);
        const update = args[1] as { $inc?: Record<string, number>; $set?: Record<string, unknown> };
        const hit =
          boundary === "fund-cash"
            ? !!update.$inc?.cashAnchor
            : boundary === "counterparty-cash"
              ? !!update.$inc?.liquidCapital
              : Array.isArray(update.$set?.shareholders);
        if (!interrupted && hit && result.matchedCount) {
          interrupted = true;
          throw new Error("Synthetic acknowledgement lost");
        }
        return result;
      };
      await f.execute().catch(() => undefined);
      expect(interrupted).toBe(true);
      for (let i = 0; i < 3; i++) await recoverAllFundFloatSettlements(f.db);
      await assertFinal(f);
    }
  );
  it.each([
    "indexFundTransactions",
    "financialTxLog",
    "ledgerEntries",
    "actionAuditLog",
    "shareTradeHistory",
  ])("recovers lost %s receipt acknowledgement", async (name) => {
    const f = fixture(direction),
      target = f.memory.collection(name),
      write = target.insertOne.bind(target);
    let interrupted = false;
    target.insertOne = async (...args: Parameters<typeof write>) => {
      const result = await write(...args);
      if (!interrupted) {
        interrupted = true;
        throw new Error("Synthetic receipt acknowledgement lost");
      }
      return result;
    };
    await f.execute().catch(() => undefined);
    expect(interrupted).toBe(true);
    for (let i = 0; i < 3; i++) await recoverAllFundFloatSettlements(f.db);
    await assertFinal(f);
  });
});
describe("fund float quote ownership", () => {
  it("refuses a stale purchase quote after the first operation is complete", async () => {
    const f = fixture("buy");
    expect(
      (await executeFundShareBuy(f.db, f.fund, f.corp, 5, 100, 7, { pools: new Map() })).ok
    ).toBe(true);
    expect(
      await executeFundShareBuy(f.db, f.fund, f.corp, 5, 100, 7, { pools: new Map() })
    ).toMatchObject({ ok: false, sharesBought: 0 });
    await assertFinal(f);
  });
  it("advances an intentional sequential buy batch without repeating its earlier quote", async () => {
    const f = fixture("buy"),
      batch: FundShareBuyBatch = { pools: new Map() };
    expect((await executeFundShareBuy(f.db, f.fund, f.corp, 5, 100, 7, batch)).ok).toBe(true);
    expect((await executeFundShareBuy(f.db, f.fund, f.corp, 5, 100, 7, batch)).ok).toBe(true);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      cashAnchor: 0,
      holdings: [{ shares: 10 }],
    });
    expect(await f.db.collection("corporations").findOne({ _id: f.corpId })).toMatchObject({
      liquidCapital: 1050,
      shareholders: [{ shares: 10 }],
      publicFloat: 990,
    });
    expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(2);
  });
  it("publishes inverse witnesses when a caller reverses its completed liquidity sale", async () => {
    const f = fixture("sell"),
      opening = await collectBalances(f.db);
    const result = await sellFundHoldingShares(f.db, f.fund, f.corpId, 5, { turn: 7 });
    expect(result.undo).toBeTypeOf("function");
    await result.undo!();
    await result.undo!();
    expect(await collectBalances(f.db)).toEqual(opening);
    expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(2);
    expect(await f.db.collection("financialTxLog").countDocuments()).toBe(4);
    const entries = await f.db.collection<LedgerEntry>("ledgerEntries").find({ turn: 7 }).toArray();
    const report = reconcileLedger({
      turn: 7,
      openingBalances: opening,
      closingBalances: opening,
      entries,
    });
    expect(report.stockVsFlow.divergentCount).toBe(0);
    expect(report.trialBalance.unbalancedCount).toBe(0);
    expect(report.unattributed).toEqual([]);
  });
});

describe("compensated quote generation", () => {
  it("allows the next intentional batch buy after a proven custody refusal is refunded", async () => {
    const f = fixture("buy"),
      target = f.memory.collection("corporations"),
      write = target.updateOne.bind(target);
    let refused = false;
    target.updateOne = async (...args: Parameters<typeof write>) => {
      if (
        !refused &&
        Array.isArray((args[1] as { $set?: { shareholders?: unknown } }).$set?.shareholders)
      ) {
        refused = true;
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      }
      return write(...args);
    };
    const batch: FundShareBuyBatch = { pools: new Map() };
    expect((await executeFundShareBuy(f.db, f.fund, f.corp, 5, 100, 7, batch)).ok).toBe(false);
    expect(batch.expectedGeneration).toBe(1);
    expect((await executeFundShareBuy(f.db, f.fund, f.corp, 5, 100, 7, batch)).ok).toBe(true);
    expect(batch.expectedGeneration).toBe(2);
    await assertFinal(f);
  });
});

describe("legacy float custody", () => {
  it("buys existing public float when an older issuer has no shareholders field", async () => {
    const f = fixture("buy");
    await f.db
      .collection("corporations")
      .updateOne({ _id: f.corpId }, { $unset: { shareholders: "" } });
    await f.execute();
    await assertFinal(f);
  });
});

describe("fund float sale policies", () => {
  it.each([3, 50])(
    "caps a sale at the held quantity for requested %i shares",
    async (requested) => {
      const f = fixture("sell");
      const result = await sellFundHoldingShares(f.db, f.fund, f.corpId, requested, { turn: 7 });
      expect(result.sharesSold).toBe(Math.min(requested, 10));
      expect(result.cashRaisedAnchor).toBe(Math.min(requested, 10) * 100);
      expect(await f.db.collection("corporations").findOne({ _id: f.corpId })).toMatchObject({
        publicFloat: 990 + Math.min(requested, 10),
      });
    }
  );
  it("refuses a zero whole-share liquidation without a custody or receipt write", async () => {
    const f = fixture("sell");
    const result = await sellFundHoldingsForRedemptionCash(
      f.db,
      { ...f.fund, holdings: [{ ...f.fund.holdings[0], shares: 0 }] },
      100,
      { corporationIds: [f.corpId] }
    );
    expect(result).toMatchObject({ sharesSold: 0, cashRaisedAnchor: 0 });
    expect(await f.db.collection("shareTradeHistory").countDocuments()).toBe(0);
  });
  it("preserves finite-pool spread, depth and counter conservation", async () => {
    const f = fixture("sell");
    await f.db
      .collection<{
        _id: string;
        cashLocal: number;
        targetCashLocal: number;
        lifetime?: { salesOut: number };
      }>("equityMarketPools")
      .insertOne({
        _id: "USD",
        cashLocal: 490,
        targetCashLocal: 490,
        lifetime: { salesOut: 0 },
      });
    const result = await sellFundHoldingShares(f.db, f.fund, f.corpId, 10, { turn: 7 });
    expect(result).toMatchObject({ sharesSold: 5, cashRaisedAnchor: 490 });
    expect(
      await f.db
        .collection<{
          _id: string;
          cashLocal: number;
          targetCashLocal: number;
          lifetime?: { salesOut: number };
        }>("equityMarketPools")
        .findOne({ _id: "USD" })
    ).toMatchObject({ cashLocal: 0, lifetime: { salesOut: 490 } });
    expect(await f.db.collection("corporations").findOne({ _id: f.corpId })).toMatchObject({
      liquidCapital: 1000,
    });
    expect(
      await f.db.collection("financialTxLog").find({ subjectType: "fund" }).toArray()
    ).toMatchObject([{ amount: 490, anchorAmount: 490 }]);
  });
  it("keeps an explicit issuer buyout at mid with a depleted pool", async () => {
    const f = fixture("sell");
    await f.db
      .collection<{
        _id: string;
        cashLocal: number;
        targetCashLocal: number;
        lifetime?: { salesOut: number };
      }>("equityMarketPools")
      .insertOne({ _id: "USD", cashLocal: 0, targetCashLocal: 490 });
    const result = await sellFundHoldingShares(f.db, f.fund, f.corpId, 5, {
      turn: 7,
      settlementCounterparty: "issuer",
    });
    expect(result).toMatchObject({ sharesSold: 5, cashRaisedAnchor: 500 });
    await assertFinal(f);
    expect(
      await f.db
        .collection<{
          _id: string;
          cashLocal: number;
          targetCashLocal: number;
          lifetime?: { salesOut: number };
        }>("equityMarketPools")
        .findOne({ _id: "USD" })
    ).toMatchObject({ cashLocal: 0 });
  });
  it("reverses every completed sale in a multi-holding redemption, twice without repetition", async () => {
    const f = fixture("sell"),
      otherId = new ObjectId();
    const other = { ...f.corp, _id: otherId, name: "Synthetic issuer two" };
    const fund = {
      ...f.fund,
      holdings: [...f.fund.holdings, { ...f.fund.holdings[0], corporationId: otherId }],
    };
    await f.db.collection("corporations").insertOne(other);
    await f.db
      .collection("indexFunds")
      .updateOne({ _id: f.fundId }, { $set: { holdings: fund.holdings } });
    const opening = await collectBalances(f.db);
    const result = await sellFundHoldingsForRedemptionCash(f.db, fund, 1000);
    expect(result).toMatchObject({ sharesSold: 10, salesExecuted: 2, cashRaisedAnchor: 1000 });
    await result.undo!();
    await result.undo!();
    expect(await collectBalances(f.db)).toEqual(opening);
    expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
      holdings: fund.holdings,
    });
    expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(4);
    const entries = await f.db.collection<LedgerEntry>("ledgerEntries").find({ turn: 7 }).toArray();
    const report = reconcileLedger({
      turn: 7,
      openingBalances: opening,
      closingBalances: opening,
      entries,
    });
    expect(report.stockVsFlow.divergentCount).toBe(0);
    expect(report.trialBalance.unbalancedCount).toBe(0);
    expect(report.unattributed).toEqual([]);
  });
});

const nativeBoundaries = [
  "ordinary",
  "claim",
  "fund-cash",
  "counterparty-cash",
  "custody",
  "indexFundTransactions",
  "financialTxLog",
  "ledgerEntries",
  "actionAuditLog",
  "shareTradeHistory",
  "finalize",
  "concurrent",
  "refusal",
  "refund-ack",
  "undo",
] as const;
function executeNative(db: Db, f: ReturnType<typeof fixture>) {
  return f.direction === "buy"
    ? executeFundShareBuy(db, f.fund, f.corp, 5, 100, 7, { pools: new Map() })
    : sellFundHoldingShares(db, f.fund, f.corpId, 5, { turn: 7 });
}
async function nativeFixture(direction: "buy" | "sell") {
  const uri = process.env.SIM_MONGODB_URI;
  if (!uri) throw new Error("Native fixture requires an explicit sandbox URI");
  const endpoint = new URL(uri);
  if (
    endpoint.protocol !== "mongodb:" ||
    !["127.0.0.1", "localhost"].includes(endpoint.hostname) ||
    !["27018", "27020"].includes(endpoint.port) ||
    endpoint.username ||
    endpoint.password ||
    !["", "/"].includes(endpoint.pathname)
  )
    throw new Error("Native fixture requires the dedicated loopback sandbox server");
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
  const db = client.db(`ahd_sim_i2223_float_${randomUUID().replaceAll("-", "")}`);
  const f = fixture(direction);
  expect(await db.listCollections().toArray()).toHaveLength(0);
  for (const name of ["indexFunds", "corporations", "gameConfig", "gameState"])
    await db.collection(name).insertMany(f.memory.collection(name).docs);
  vi.mocked(getDb).mockResolvedValue(db);
  return { ...f, db, client };
}
function interruptedDb(db: Db, boundary: (typeof nativeBoundaries)[number]) {
  let hit = false,
    refused = false;
  const wrapped = new Proxy(db, {
    get(target, property) {
      if (property !== "collection") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (name: string) =>
        new Proxy(target.collection(name), {
          get(collection, method) {
            const value = Reflect.get(collection, method);
            if (typeof value !== "function") return value;
            if (!["insertOne", "updateOne", "findOneAndUpdate"].includes(String(method)))
              return value.bind(collection);
            return async (...args: unknown[]) => {
              const update = args[1] as {
                $inc?: Record<string, number>;
                $set?: Record<string, unknown>;
              };
              if (
                boundary === "refund-ack" &&
                !refused &&
                name === "corporations" &&
                method === "updateOne" &&
                Array.isArray(update?.$set?.shareholders)
              ) {
                refused = true;
                return { matchedCount: 0, modifiedCount: 0 };
              }
              const matches =
                (boundary === "refund-ack" &&
                  method === "updateOne" &&
                  Number(update?.$inc?.cashAnchor ?? update?.$inc?.liquidCapital) > 0) ||
                (boundary === name && method === "insertOne") ||
                (boundary === "claim" &&
                  name === "indexFunds" &&
                  method === "findOneAndUpdate" &&
                  !!update?.$set?.floatSettlementPlan) ||
                (boundary === "finalize" &&
                  name === "indexFunds" &&
                  method === "updateOne" &&
                  update?.$set?.["floatSettlementPlan.state"] === "completed") ||
                (boundary === "fund-cash" &&
                  name === "indexFunds" &&
                  method === "updateOne" &&
                  !!update?.$inc?.cashAnchor) ||
                (boundary === "counterparty-cash" &&
                  name === "corporations" &&
                  method === "updateOne" &&
                  !!update?.$inc?.liquidCapital) ||
                (["custody", "refusal"].includes(boundary) &&
                  name === "corporations" &&
                  method === "updateOne" &&
                  Array.isArray(update?.$set?.shareholders));
              if (matches && !hit && boundary === "refusal") {
                hit = true;
                return { matchedCount: 0, modifiedCount: 0 };
              }
              const result = await value.apply(collection, args);
              if (matches && !hit) {
                hit = true;
                throw new Error("Synthetic native acknowledgement lost");
              }
              return result;
            };
          },
        });
    },
  });
  return { db: wrapped, hit: () => hit };
}
describe.skipIf(process.env.AHD_FUND_FLOAT_REAL_MONGO !== "1").each(["buy", "sell"] as const)(
  "native fund float %s",
  (direction) => {
    it.each(nativeBoundaries)(
      "qualifies %s with real cash, custody and receipt writes",
      async (boundary) => {
        const f = await nativeFixture(direction);
        try {
          const hello = await f.db.admin().command({ hello: 1 });
          const opening = await collectBalances(f.db);
          const injected = interruptedDb(f.db, boundary);
          if (boundary === "concurrent") {
            const results = await Promise.allSettled([
              executeNative(injected.db, f),
              executeNative(injected.db, f),
            ]);
            expect(results.some((r) => r.status === "fulfilled")).toBe(true);
          } else await executeNative(injected.db, f).catch(() => undefined);
          if (!["ordinary", "concurrent", "undo"].includes(boundary))
            expect(injected.hit()).toBe(true);
          for (let i = 0; i < 3; i++) await recoverAllFundFloatSettlements(injected.db);
          if (boundary === "refusal" || boundary === "refund-ack") {
            expect(await collectBalances(f.db)).toEqual(opening);
            expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(0);
            expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
              holdings: f.fund.holdings,
              floatSettlementPlan: { state: "cancelled" },
            });
          } else {
            await assertFinal(f);
            if (boundary === "undo") {
              const fund = await f.db
                .collection<SettlementFund>("indexFunds")
                .findOne({ _id: f.fundId });
              const { reverseCompletedFundFloatPlan } = await import("./fundFloatSettlement");
              await reverseCompletedFundFloatPlan(f.db, f.fundId, fund!.floatSettlementPlan!);
              await reverseCompletedFundFloatPlan(f.db, f.fundId, fund!.floatSettlementPlan!);
              expect(await collectBalances(f.db)).toEqual(opening);
              expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(2);
            }
            const closing = await collectBalances(f.db);
            const entries = await f.db
              .collection<LedgerEntry>("ledgerEntries")
              .find({ turn: 7 })
              .toArray();
            const report = reconcileLedger({
              turn: 7,
              openingBalances: opening,
              closingBalances: closing,
              entries,
            });
            expect(report.stockVsFlow.divergentCount).toBe(0);
            expect(report.trialBalance.unbalancedCount).toBe(0);
            expect(report.unattributed).toEqual([]);
          }
          process.stdout.write(
            JSON.stringify({
              direction,
              boundary,
              replicaSet: hello.setName ?? null,
              passed: true,
            }) + "\n"
          );
        } finally {
          await f.client.close();
        }
      }
    );
    it.each([
      "finite-pool",
      "escrow",
      "legacy-custody",
      "ipo",
      "frozen-fx",
      "multiple-undo",
    ] as const)("qualifies native %s routing", async (route) => {
      const f = await nativeFixture(direction);
      try {
        const hello = await f.db.admin().command({ hello: 1 });
        if (route === "legacy-custody" && direction === "buy")
          await f.db
            .collection("corporations")
            .updateOne({ _id: f.corpId }, { $unset: { shareholders: "" } });
        if (route === "escrow") {
          await f.db.collection("corporations").updateOne(
            { _id: f.corpId },
            {
              $set: {
                shareBuybackMode: "escrow",
                shareEscrowBalance: direction === "sell" ? 200 : 0,
              },
            }
          );
          Object.assign(f.corp, { shareBuybackMode: "escrow" });
        }
        if (route === "finite-pool" || route === "ipo") {
          await f.db
            .collection<{ _id: string } & Record<string, unknown>>("equityMarketPools")
            .insertOne({
              _id: "USD",
              cashLocal: 1000,
              targetCashLocal: 1000,
              lifetime: { purchasesIn: 0, salesOut: 0 },
            });
          if (route === "ipo" && direction === "buy")
            await f.db.collection("corporations").updateOne(
              { _id: f.corpId },
              {
                $set: {
                  pendingShareIssuance: {
                    source: "ipo",
                    issuedUpfront: true,
                    remainingShares: 2,
                  },
                },
              }
            );
        }
        if (route === "frozen-fx") {
          Object.assign(f.corp, { liquidCurrencyCode: "GBP", countryId: "UK" });
          await f.db
            .collection("corporations")
            .updateOne({ _id: f.corpId }, { $set: { liquidCurrencyCode: "GBP", countryId: "UK" } });
          await f.db.collection("exchangeRates").insertOne({ currencyCode: "GBP", rate: 2 });
        }
        if (route === "multiple-undo" && direction === "sell") {
          const otherId = new ObjectId();
          await f.db.collection("corporations").insertOne({ ...f.corp, _id: otherId });
          f.fund.holdings.push({ ...f.fund.holdings[0], corporationId: otherId });
          await f.db
            .collection("indexFunds")
            .updateOne({ _id: f.fundId }, { $set: { holdings: f.fund.holdings } });
          const opening = await collectBalances(f.db);
          const result = await sellFundHoldingsForRedemptionCash(f.db, f.fund, 1000);
          expect(result.salesExecuted).toBe(2);
          await result.undo!();
          await result.undo!();
          expect(await collectBalances(f.db)).toEqual(opening);
          expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(4);
        } else {
          const pools = new Map(
            (
              await f.db
                .collection<{ _id: string } & Record<string, unknown>>("equityMarketPools")
                .find({})
                .toArray()
            ).map((p) => [p._id, p])
          );
          // Only the receipt publication is refused, after the real cash and custody writes.
          // The original operation must remain durable while rates change before recovery.
          let blocked = route === "frozen-fx";
          const bound = new Proxy(f.db, {
            get(target, property) {
              if (property !== "collection") {
                const value = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
              }
              return (name: string) => {
                const collection = target.collection(name);
                if (name !== "shareTradeHistory") return collection;
                return new Proxy(collection, {
                  get(coll, method) {
                    const value = Reflect.get(coll, method);
                    if (method === "insertOne")
                      return async (...args: unknown[]) => {
                        if (blocked) throw new Error("Synthetic receipt outage");
                        return value.apply(coll, args);
                      };
                    return typeof value === "function" ? value.bind(coll) : value;
                  },
                });
              };
            },
          });
          if (direction === "buy")
            await executeFundShareBuy(
              bound,
              f.fund,
              f.corp,
              5,
              route === "frozen-fx" ? 50 : 100,
              7,
              { pools: pools as unknown as FundShareBuyBatch["pools"] }
            ).catch(() => undefined);
          else
            await sellFundHoldingShares(bound, f.fund, f.corpId, 5, {
              turn: 7,
              ...(route === "frozen-fx" ? { fxByCurrency: new Map([["GBP", 2]]) } : {}),
            }).catch(() => undefined);
          if (blocked) {
            expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
              floatSettlementPlan: { state: "pending" },
            });
            await f.db
              .collection("exchangeRates")
              .updateOne({ currencyCode: "GBP" }, { $set: { rate: 99 } });
            blocked = false;
          }
          for (let i = 0; i < 3; i++) await recoverAllFundFloatSettlements(f.db);
          const fund = await f.db
            .collection<SettlementFund>("indexFunds")
            .findOne({ _id: f.fundId });
          const corp = await f.db.collection("corporations").findOne({ _id: f.corpId });
          const pool = await f.db
            .collection<{ _id: string } & { cashLocal: number; lifetime: Record<string, number> }>(
              "equityMarketPools"
            )
            .findOne({ _id: "USD" });
          const buying = direction === "buy",
            pooled = route === "finite-pool" || route === "ipo";
          const anchorAmount = route === "frozen-fx" ? 250 : pooled ? (buying ? 510 : 490) : 500;
          expect(fund!.cashAnchor).toBe(
            f.fund.cashAnchor + (buying ? -anchorAmount : anchorAmount)
          );
          expect(fund!.holdings[0].shares).toBe(5);
          expect(corp!.publicFloat).toBe(995);
          expect(corp!.shareholders[0].shares).toBe(5);
          expect(fund!.floatSettlementPlan!.state).toBe("completed");
          if (pooled) {
            expect(fund!.cashAnchor + corp!.liquidCapital + pool!.cashLocal).toBe(2050);
            expect(pool!.lifetime[buying ? "purchasesIn" : "salesOut"]).toBe(
              route === "ipo" && buying ? 306 : anchorAmount
            );
            if (route === "ipo" && buying)
              expect(corp!.pendingShareIssuance.remainingShares).toBe(0);
          } else if (route === "escrow")
            expect(fund!.cashAnchor + corp!.liquidCapital + corp!.shareEscrowBalance).toBe(
              buying ? 1050 : 1250
            );
          else if (route === "frozen-fx") {
            expect(fund!.cashAnchor + corp!.liquidCapital / 2).toBe(buying ? 1025 : 550);
            expect(
              await f.db.collection("financialTxLog").findOne({ subjectType: "corporation" })
            ).toMatchObject({
              currencyCode: "GBP",
              amount: buying ? 500 : -500,
              anchorAmount: buying ? 250 : -250,
            });
          } else await assertFinal(f);
          expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(1);
        }
        process.stdout.write(
          JSON.stringify({
            direction,
            boundary: route,
            replicaSet: hello.setName ?? null,
            passed: true,
          }) + "\n"
        );
      } finally {
        await f.client.close();
      }
    });
    it("participates in an outer transaction that can abort all effects", async () => {
      const f = await nativeFixture(direction);
      try {
        const hello = await f.db.admin().command({ hello: 1 });
        if (!hello.setName) return;
        const session = f.client.startSession();
        const opening = await collectBalances(f.db);
        try {
          await expect(
            session.withTransaction(async () => {
              if (direction === "sell") {
                const result = await sellFundHoldingShares(f.db, f.fund, f.corpId, 5, {
                  session,
                  turn: 7,
                });
                expect(result.sharesSold).toBe(5);
              } else {
                const { fundSettlementDb } = await import("./fundFloatSettlement");
                const { loadFloatAuditContext } = await import("./fundFloatTradePlan");
                const bound = fundSettlementDb(f.db, session);
                const result = await executeFundShareBuy(bound, f.fund, f.corp, 5, 100, 7, {
                  pools: new Map(),
                  audit: await loadFloatAuditContext(bound, session),
                });
                expect(result.ok).toBe(true);
              }
              throw new Error("Synthetic outer abort");
            })
          ).rejects.toThrow("Synthetic outer abort");
        } finally {
          await session.endSession();
        }
        expect(await collectBalances(f.db)).toEqual(opening);
        expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
          holdings: f.fund.holdings,
        });
        for (const name of [
          "indexFundTransactions",
          "financialTxLog",
          "ledgerEntries",
          "actionAuditLog",
          "shareTradeHistory",
        ])
          expect(await f.db.collection(name).countDocuments()).toBe(0);
        expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).not.toHaveProperty(
          "floatSettlementPlan"
        );
        process.stdout.write(
          JSON.stringify({
            direction,
            boundary: "transaction-abort",
            replicaSet: hello.setName,
            passed: true,
          }) + "\n"
        );
      } finally {
        await f.client.close();
      }
    });
  }
);
