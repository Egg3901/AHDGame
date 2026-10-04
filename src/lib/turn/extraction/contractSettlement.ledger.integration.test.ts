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
});
