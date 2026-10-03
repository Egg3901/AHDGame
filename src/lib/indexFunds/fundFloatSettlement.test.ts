/** Frozen float plans preserve cash and share custody across interrupted writes. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { DEFAULT_TX_THRESHOLDS } from "@/lib/db/types/financialTxLog";
import { prepareFundFloatTrade } from "./fundFloatTradePlan";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { settleTransition } from "@/lib/banking/settlementJournal";
import {
  claimFundFloatPlan,
  recoverAllFundFloatSettlements,
  settleFundFloatPlan,
  reverseCompletedFundFloatPlan,
  type FundFloatPlan,
  type SettlementFund,
} from "./fundFloatSettlement";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
function fixture() {
  const memory = createInMemoryDb(),
    db = memory as unknown as Db;
  const fundId = new ObjectId(),
    corporationId = new ObjectId(),
    receiptId = new ObjectId();
  const now = new Date("2000-01-01T00:00:00Z");
  const fund: SettlementFund = {
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
    cashAnchor: 1000,
    holdings: [],
    targetConstituents: [],
    createdAt: now,
    updatedAt: now,
  };
  const after = [{ corporationId, shares: 10, avgCostPerShareAnchor: 100, lastValueAnchor: 1000 }];
  const shareholders = [{ fundId, shares: 10, avgCostPerShare: 100 }];
  const key = `synthetic-float:${fundId}`;
  const plan: FundFloatPlan = {
    key,
    state: "pending",
    direction: "buy",
    corporationId,
    shares: 10,
    amountAnchor: 1000,
    holdingsBefore: [],
    holdingsAfter: after,
    inverseCustody: {
      kind: "asset",
      amount: 0,
      collection: "corporations",
      filter: { _id: corporationId, shareholders, publicFloat: 90 },
      set: { shareholders: [], publicFloat: 100 },
      note: "Return original shares",
    },
    transition: {
      key,
      kind: "fund_float_buy",
      turn: 7,
      currency: "USD",
      legs: [
        {
          kind: "debit",
          amount: 1000,
          collection: "indexFunds",
          path: "cashAnchor",
          filter: { _id: fundId, "floatSettlementPlan.key": key, holdings: [] },
          set: { holdings: after },
          note: "Pay for the original frozen shares",
        },
        {
          kind: "asset",
          amount: 0,
          collection: "corporations",
          filter: { _id: corporationId, shareholders: [], publicFloat: 100 },
          set: { shareholders, publicFloat: 90 },
          note: "Original share custody",
        },
        {
          kind: "credit",
          amount: 1000,
          collection: "corporations",
          path: "liquidCapital",
          filter: { _id: corporationId },
          note: "Original cash counterparty",
        },
      ],
      projections: [
        {
          collection: "indexFundTransactions",
          insert: { _id: receiptId, fundId, amountAnchor: 1000 },
          note: "Original receipt",
        },
        {
          collection: "indexFunds",
          filter: { _id: fundId, "floatSettlementPlan.key": key },
          update: { $set: { "floatSettlementPlan.state": "completed" } },
          note: "Complete original quote",
        },
      ],
      event: { kind: "prop.traded", command: "fund_float_buy" },
    },
  };
  memory.seed("indexFunds", [{ ...fund }]);
  memory.seed("corporations", [
    { _id: corporationId, publicFloat: 100, shareholders: [], liquidCapital: 50 },
  ]);
  return { memory, db, fundId, corporationId, fund, plan };
}
async function assertCompleted(f: ReturnType<typeof fixture>) {
  const fund = await f.db.collection<SettlementFund>("indexFunds").findOne({ _id: f.fundId });
  const corp = await f.db.collection("corporations").findOne({ _id: f.corporationId });
  expect(fund!.cashAnchor + corp!.liquidCapital).toBe(1050);
  expect(fund).toMatchObject({
    cashAnchor: 0,
    holdings: f.plan.holdingsAfter,
    floatSettlementPlan: { state: "completed" },
  });
  expect(corp).toMatchObject({
    publicFloat: 90,
    liquidCapital: 1050,
    shareholders: [{ fundId: f.fundId, shares: 10 }],
  });
  expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(1);
}
describe("fund float settlement", () => {
  it("settles the actual prepared trade with complete cash, custody and accounting witnesses", async () => {
    const f = fixture(),
      opening = await collectBalances(f.db);
    const prepared = await prepareFundFloatTrade(f.db, {
      fund: f.fund,
      corp: {
        _id: f.corporationId,
        name: "Synthetic issuer",
        countryId: "US",
        liquidCurrencyCode: "USD",
        publicFloat: 100,
        totalShares: 1000,
        shareBuybackMode: "instant",
      },
      direction: "buy",
      shares: 10,
      priceLocal: 100,
      priceAnchor: 100,
      amountAnchor: 1000,
      turn: 7,
      pools: new Map(),
      holdingsAfter: () => f.plan.holdingsAfter,
      audit: {
        thresholds: DEFAULT_TX_THRESHOLDS,
        turnLength: 60,
        shadow: true,
        auditEnabled: true,
        ledgerTurn: null,
      },
    });
    expect(prepared).toBeDefined();
    expect(await claimFundFloatPlan(f.db, prepared!.fund, prepared!.plan)).toBe(true);
    expect(await settleFundFloatPlan(f.db, f.fundId, prepared!.plan)).toBe(true);
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
    expect(entries).toHaveLength(2);
    expect(await f.db.collection("financialTxLog").countDocuments()).toBe(2);
    expect(await f.db.collection("actionAuditLog").countDocuments()).toBe(2);
    expect(await f.db.collection("shareTradeHistory").countDocuments()).toBe(1);
    await assertCompleted(f);
    await reverseCompletedFundFloatPlan(f.db, f.fundId, prepared!.plan);
    await reverseCompletedFundFloatPlan(f.db, f.fundId, prepared!.plan);
    await recoverAllFundFloatSettlements(f.db);
    const reverted = await collectBalances(f.db);
    expect(reverted).toEqual(opening);
    const inverseEntries = await f.db
      .collection<LedgerEntry>("ledgerEntries")
      .find({ turn: 7 })
      .toArray();
    const inverseReport = reconcileLedger({
      turn: 7,
      openingBalances: opening,
      closingBalances: reverted,
      entries: inverseEntries,
    });
    expect(inverseReport.stockVsFlow.divergentCount).toBe(0);
    expect(inverseReport.trialBalance.unbalancedCount).toBe(0);
    expect(inverseReport.unattributed).toEqual([]);
    expect(inverseEntries).toHaveLength(4);
    expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(2);
    expect(await f.db.collection("financialTxLog").countDocuments()).toBe(4);
    expect(await f.db.collection("shareTradeHistory").countDocuments()).toBe(2);
  });
  it.each(["balance", "shares", "magnitude"])(
    "refuses an invalid custody %s before claiming or moving cash",
    async (invalid) => {
      const f = fixture(),
        asset = f.plan.transition.legs[1];
      if (invalid === "balance") asset.set = { ...asset.set, liquidCapital: 99999 };
      if (invalid === "shares") asset.set = { ...asset.set, publicFloat: 100 };
      if (invalid === "magnitude") asset.amount = 1;
      expect((await settleTransition(f.db, f.plan.transition)).status).toBe("rejected");
      expect(await f.db.collection("bankMoneyMoves").countDocuments()).toBe(0);
      expect(await f.db.collection("indexFunds").findOne({ _id: f.fundId })).toMatchObject({
        cashAnchor: 1000,
        holdings: [],
      });
      expect(await f.db.collection("corporations").findOne({ _id: f.corporationId })).toMatchObject(
        { liquidCapital: 50, publicFloat: 100, shareholders: [] }
      );
    }
  );
  it.each(["debit", "custody", "credit"])(
    "recovers a lost %s acknowledgement without repeating cash or shares",
    async (boundary) => {
      const f = fixture();
      const name = boundary === "debit" ? "indexFunds" : "corporations";
      const target = f.memory.collection(name),
        update = target.updateOne.bind(target);
      let interrupted = false;
      target.updateOne = async (...args: Parameters<typeof update>) => {
        const result = await update(...args);
        const change = args[1] as { $inc?: Record<string, number>; $set?: Record<string, unknown> };
        const hit =
          boundary === "debit"
            ? change.$inc?.cashAnchor === -1000
            : boundary === "credit"
              ? change.$inc?.liquidCapital === 1000
              : change.$set?.publicFloat === 90;
        if (!interrupted && hit && result.matchedCount) {
          interrupted = true;
          throw new Error("Synthetic acknowledgement lost");
        }
        return result;
      };
      expect(await claimFundFloatPlan(f.db, f.fund, f.plan)).toBe(true);
      await settleFundFloatPlan(f.db, f.fundId, f.plan).catch(() => undefined);
      expect(interrupted).toBe(true);
      for (let i = 0; i < 3; i++) {
        await recoverAllFundFloatSettlements(f.db);
        await settleFundFloatPlan(f.db, f.fundId, f.plan);
      }
      await assertCompleted(f);
    }
  );
  it("admits only one quote from simultaneous fund claims", async () => {
    const f = fixture();
    const competing = { ...f.plan, key: f.plan.key + ":competing" };
    const claimed = await Promise.all([
      claimFundFloatPlan(f.db, f.fund, f.plan),
      claimFundFloatPlan(f.db, f.fund, competing),
    ]);
    expect(claimed).toEqual([true, false]);
    await recoverAllFundFloatSettlements(f.db);
    await assertCompleted(f);
  });
  it("recovers an acknowledged database claim whose caller lost the response", async () => {
    const f = fixture(),
      target = f.memory.collection("indexFunds"),
      write = target.findOneAndUpdate.bind(target);
    target.findOneAndUpdate = async (...args: Parameters<typeof write>) => {
      const result = await write(...args);
      if (result) throw new Error("Synthetic claim acknowledgement lost");
      return result;
    };
    await expect(claimFundFloatPlan(f.db, f.fund, f.plan)).rejects.toThrow("claim acknowledgement");
    await recoverAllFundFloatSettlements(f.db);
    await assertCompleted(f);
  });
  it.each([false, true])(
    "compensates a proven custody refusal with refund acknowledgement loss=%s",
    async (loseRefundAck) => {
      const f = fixture();
      await claimFundFloatPlan(f.db, f.fund, f.plan);
      const otherHolder = [{ characterId: new ObjectId(), shares: 10 }];
      await f.db
        .collection("corporations")
        .updateOne(
          { _id: f.corporationId },
          { $set: { publicFloat: 90, shareholders: otherHolder } }
        );
      const target = f.memory.collection("indexFunds"),
        write = target.updateOne.bind(target);
      let interrupted = false;
      target.updateOne = async (...args: Parameters<typeof write>) => {
        const result = await write(...args);
        if (
          loseRefundAck &&
          !interrupted &&
          (args[1] as { $inc?: { cashAnchor?: number } }).$inc?.cashAnchor === 1000
        ) {
          interrupted = true;
          throw new Error("Synthetic refund acknowledgement lost");
        }
        return result;
      };
      await settleFundFloatPlan(f.db, f.fundId, f.plan).catch(() => undefined);
      for (let i = 0; i < 3; i++) await recoverAllFundFloatSettlements(f.db);
      const fund = await f.db.collection<SettlementFund>("indexFunds").findOne({ _id: f.fundId });
      const corp = await f.db.collection("corporations").findOne({ _id: f.corporationId });
      expect(fund).toMatchObject({
        cashAnchor: 1000,
        holdings: [],
        floatSettlementPlan: { state: "cancelled" },
      });
      expect(corp).toMatchObject({ liquidCapital: 50, publicFloat: 90, shareholders: otherHolder });
      expect(await f.db.collection("indexFundTransactions").countDocuments()).toBe(0);
      expect(interrupted).toBe(loseRefundAck);
    }
  );
});
