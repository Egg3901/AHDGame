import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { settleExtractionContracts } from "./contractSettlement";

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue("applied"),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

const TURN = 4;
const NOW = new Date("2026-10-04T00:00:00Z");
const CORP_ID = new ObjectId("650000000000000000000050");
const CONTRACT_ID = new ObjectId("650000000000000000000051");

function hideFirstReceiptBatchRead(db: Db, receiptKey: string): Db {
  let hidden = false;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "collection") {
        return (name: string) => {
          const collection = target.collection(name);
          if (name !== "bankMoneyMoves") return collection;
          return new Proxy(collection, {
            get(collectionTarget, collectionProperty, collectionReceiver) {
              if (collectionProperty === "find") {
                return (filter: Record<string, unknown>, ...args: unknown[]) => {
                  const ids = (filter._id as { $in?: string[] } | undefined)?.$in;
                  if (!hidden && ids?.includes(receiptKey)) {
                    hidden = true;
                    return { toArray: async () => [] };
                  }
                  const find = Reflect.get(
                    collectionTarget,
                    collectionProperty,
                    collectionReceiver
                  ) as (...params: unknown[]) => unknown;
                  return find.apply(collectionTarget, [filter, ...args]);
                };
              }
              const value = Reflect.get(collectionTarget, collectionProperty, collectionReceiver);
              return typeof value === "function" ? value.bind(collectionTarget) : value;
            },
          });
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function setup() {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN, preset: "2019-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  db.seed("federalBudget", [
    {
      _id: "US",
      countryId: "US",
      currencyCode: "USD",
      treasuryCashLocal: 10,
      treasuryBalance: -20,
    },
  ]);
  db.seed("corporations", [
    {
      _id: CORP_ID,
      name: "Fixture Oil",
      countryId: "US",
      liquidCurrencyCode: "USD",
      liquidCapital: 100,
    },
  ]);
  const contract: ExtractionContract = {
    _id: CONTRACT_ID,
    stateId: "TX",
    countryId: "US",
    corporationId: CORP_ID,
    resource: "oil",
    share: 0.5,
    grantedTurn: 1,
    grantedBy: "US",
    grantedByLevel: "national",
    status: "active",
    royaltyRatePerTurn: 0.01,
    missedPayments: 0,
    updatedAt: NOW,
  };
  db.seed("extractionContracts", [contract as unknown as Record<string, unknown>]);
  db.seed("stateResourceCapacity", [
    {
      _id: new ObjectId(),
      stateId: "TX",
      countryId: "US",
      resources: { oil: 1_000 },
      updatedAt: NOW,
    },
  ]);
  db.seed("commodityPrices", [
    {
      commodity: "oil",
      basePrice: 1,
      globalPrice: 1,
      statePrices: { TX: 1 },
      turn: TURN,
      updatedAt: NOW,
    },
  ]);
  return { db, contract };
}

describe("funded national extraction royalties", () => {
  beforeEach(() => resetCorpFxRateCacheForTests());

  it.each([
    ["payer debit", "corporations", "liquidCapital", -5],
    ["Treasury credit", "federalBudget", "treasuryCashLocal", 5],
  ])("replays a crash after the %s leg exactly once", async (_label, collection, path, value) => {
    const { db } = setup();
    const fault = withInjectedCrash(db, {
      collection,
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.[path] === value;
      },
    });

    await expect(settleExtractionContracts(fault.db, TURN, NOW, true)).rejects.toThrow(
      "crash after"
    );
    fault.disarm();
    await db.collection("exchangeRates").updateOne({ currencyCode: "USD" }, { $set: { rate: 8 } });
    await db
      .collection("commodityPrices")
      .updateOne({ commodity: "oil" }, { $set: { globalPrice: 99, statePrices: { TX: 99 } } });

    await settleExtractionContracts(fault.db, TURN, NOW, true);
    await settleExtractionContracts(fault.db, TURN, NOW, true);

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(95);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 15,
      treasuryBalance: -15,
    });
    expect(db.collection("extractionContracts").docs[0]).toMatchObject({
      lastRoyaltyTurn: TURN,
      missedPayments: 0,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });

  it("does not treat an in-flight replay as a completed royalty", async () => {
    const { db } = setup();
    const receiptKey = `extraction-royalty:${CONTRACT_ID.toString()}:${TURN}`;
    const fault = withInjectedCrash(db, {
      collection: "bankMoneyMoves",
      op: "insertOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        return (args[0] as { _id?: string })._id === receiptKey;
      },
    });

    await expect(settleExtractionContracts(fault.db, TURN, NOW, true)).rejects.toThrow(
      "crash after"
    );
    fault.disarm();
    expect(db.collection("bankMoneyMoves").docs[0]?.status).toBe("partial");
    expect(
      (db.collection("bankMoneyMoves").docs[0]?.legs as { applied: boolean }[]).map(
        (leg) => leg.applied
      )
    ).toEqual([false, false]);
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.clearAllMocks();
    const recoveryFault = withInjectedCrash(db, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.liquidCapital === -5;
      },
    });

    await expect(
      settleExtractionContracts(
        hideFirstReceiptBatchRead(recoveryFault.db, receiptKey),
        TURN,
        NOW,
        true
      )
    ).rejects.toThrow("crash before corporations.updateOne");

    expect(emitTx).not.toHaveBeenCalled();
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(100);
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(10);
    expect(db.collection("bankMoneyMoves").docs[0]?.status).toBe("partial");
  });

  it("logs the winning receipt quote when a concurrent caller has stale FX", async () => {
    const { db } = setup();
    await db
      .collection("corporations")
      .updateOne({ _id: CORP_ID }, { $set: { liquidCurrencyCode: "GBP" } });
    await db.collection("exchangeRates").insertOne({ currencyCode: "GBP", rate: 2 } as never);
    resetCorpFxRateCacheForTests();
    await settleExtractionContracts(db as unknown as Db, TURN, NOW, true);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.clearAllMocks();
    await db.collection("exchangeRates").updateOne({ currencyCode: "GBP" }, { $set: { rate: 8 } });
    await db
      .collection("extractionContracts")
      .updateOne({ _id: CONTRACT_ID }, { $unset: { lastRoyaltyTurn: "" } });
    resetCorpFxRateCacheForTests();
    const receiptKey = `extraction-royalty:${CONTRACT_ID.toString()}:${TURN}`;

    await settleExtractionContracts(
      hideFirstReceiptBatchRead(db as unknown as Db, receiptKey),
      TURN,
      NOW,
      true
    );

    expect(emitTx).toHaveBeenCalledTimes(2);
    const emitTxMock = vi.mocked(emitTx) as unknown as ReturnType<typeof vi.fn>;
    expect(emitTxMock.mock.calls[0]?.[1]).toMatchObject({ amount: -10, currencyCode: "GBP" });
    expect(emitTxMock.mock.calls[1]?.[1]).toMatchObject({ amount: 5, currencyCode: "USD" });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(90);
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(15);
  });

  it("resumes a frozen national fallback receipt if a state budget appears before retry", async () => {
    const { db } = setup();
    await db
      .collection("extractionContracts")
      .updateOne({ _id: CONTRACT_ID }, { $set: { grantedByLevel: "state" } });
    const fault = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.treasuryCashLocal === 5;
      },
    });

    await expect(settleExtractionContracts(fault.db, TURN, NOW, true)).rejects.toThrow(
      "crash after"
    );
    fault.disarm();
    await db.collection("stateBudgets").insertOne({
      _id: "TX",
      countryId: "US",
      revenue: { total: 0, resourceRoyalties: 0 },
    } as never);
    resetCorpFxRateCacheForTests();

    await settleExtractionContracts(db as unknown as Db, TURN, NOW, true);

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(95);
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(15);
    expect(db.collection("stateBudgets").docs[0]?.revenue).toMatchObject({
      total: 0,
      resourceRoyalties: 0,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });

  it("does not create spendable Treasury cash when the payer lacks funds", async () => {
    const { db } = setup();
    await db.collection("corporations").updateOne({ _id: CORP_ID }, { $set: { liquidCapital: 0 } });

    const result = await settleExtractionContracts(db as unknown as Db, TURN, NOW, true);

    expect(result.paymentsMissed).toBe(1);
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(0);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 10,
      treasuryBalance: -20,
    });
    expect(db.collection("extractionContracts").docs[0]).toMatchObject({
      lastRoyaltyTurn: TURN,
      missedPayments: 1,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);
  });

  it("routes a state-granted royalty to funded Treasury cash if its state budget is absent", async () => {
    const { db } = setup();
    await db
      .collection("extractionContracts")
      .updateOne({ _id: CONTRACT_ID }, { $set: { grantedByLevel: "state" } });

    await settleExtractionContracts(db as unknown as Db, TURN, NOW, true);

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(95);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 15,
      treasuryBalance: -15,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });

  it("fails closed when a required non-anchor corporate exchange rate is missing", async () => {
    const { db } = setup();
    await db
      .collection("corporations")
      .updateOne({ _id: CORP_ID }, { $set: { liquidCurrencyCode: "GBP" } });
    resetCorpFxRateCacheForTests();

    await expect(settleExtractionContracts(db as unknown as Db, TURN, NOW, true)).rejects.toThrow(
      /Missing valid treasury-accrual exchange rate for GBP/
    );

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(100);
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(10);
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);
  });
});
