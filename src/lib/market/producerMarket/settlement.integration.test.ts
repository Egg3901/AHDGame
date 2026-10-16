import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { collectBalances } from "@/lib/ledger/balanceSnapshot";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { snapshotMoneySupply } from "@/lib/moneySupply/snapshot";
import { settleProducerTurn } from "./settlement";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const corporationId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const sectorId = "bbbbbbbbbbbbbbbbbbbbbbbb";

function fixture() {
  const memory = createInMemoryDb();
  memory.seed("gameState", [
    { _id: "current", worldEpochId: "example", isProcessing: true, processingTargetTurn: 1 },
  ]);
  memory.seed("corporations", [
    {
      _id: new ObjectId(corporationId),
      liquidCapital: 1000,
      liquidCurrencyCode: "USD",
      countryId: "US",
      bankCharter: { cashReserves: 9000, totalLoans: 6000, totalDeposits: 8000 },
    },
  ]);
  memory.seed("corporateSectors", [
    {
      _id: new ObjectId(sectorId),
      corporationId: new ObjectId(corporationId),
      pricingPosture: 0.2,
    },
  ]);
  memory.seed("producerEconomyAccounts", [
    {
      _id: "households",
      worldEpoch: "example",
      cash: 100,
      currency: "USD",
      kind: "households",
      countryId: "US",
    },
    {
      _id: "operating",
      worldEpoch: "example",
      cash: 0,
      currency: "USD",
      kind: "operatingPayee",
      countryId: "US",
    },
  ]);
  const input: Parameters<typeof settleProducerTurn>[1] = {
    worldEpoch: "example",
    production: {
      turn: 1,
      accounts: [
        { id: "corp", cash: 500 },
        { id: "households", cash: 50 },
        { id: "operating", cash: 0 },
      ],
      producers: [
        {
          id: "plant",
          accountId: "corp",
          capacityUnits: 10,
          activeFraction: 1,
          outputMultiplier: 1,
          inputs: [],
          outputs: [
            {
              commodity: "goods",
              book: "world",
              unitsPerOutput: 1,
              policy: { kind: "manual", unitPrice: 3 },
              referenceUnitPrice: 3,
              storable: true,
            },
          ],
          labourCost: 10,
          otherOperatingCost: 5,
          labourRecipientAccountId: "households",
          operatingRecipientAccountId: "operating",
          inputStock: [],
          outputStock: [],
        },
      ],
      households: [
        {
          accountId: "households",
          spendFraction: 1,
          products: [{ commodity: "goods", book: "world", maximumUnitPrice: 3, weight: 1 }],
        },
      ],
    },
    bindings: [
      {
        kind: "corporation",
        accountId: "corp",
        corporationId,
        currency: "USD",
        localPerAnchor: 2,
        openingCashLocal: 1000,
      },
      {
        kind: "economyAccount",
        accountId: "households",
        economyAccountId: "households",
        currency: "USD",
        localPerAnchor: 2,
        openingCashLocal: 100,
      },
      {
        kind: "economyAccount",
        accountId: "operating",
        economyAccountId: "operating",
        currency: "USD",
        localPerAnchor: 2,
        openingCashLocal: 0,
      },
    ],
    targets: [{ producerId: "plant", sectorId, corporationId }],
  };
  return { memory, input, db: memory as unknown as Db };
}

describe("frozen producer turn settlement", () => {
  it("publishes the same delivered receipt that paid cash and preserves bank and user-command fields", async () => {
    const { memory, input, db } = fixture();
    const result = await settleProducerTurn(db, input);
    expect(result.producers[0]).toMatchObject({
      producedUnits: 10,
      deliveredUnits: 10,
      revenue: 30,
      profit: 15,
      cashFlow: 15,
    });
    expect(memory.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: 1030,
      bankCharter: { cashReserves: 9000, totalLoans: 6000, totalDeposits: 8000 },
    });
    expect(memory.collection("corporateSectors").docs[0]).toMatchObject({
      pricingPosture: 0.2,
      producerSettlement: { worldEpoch: "example", turn: 1, revenue: 30 },
    });
    expect(memory.collection("producerEconomyTurns").docs[0].status).toBe("settled");
    expect(await settleProducerTurn(db, input)).toEqual(result);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1030);
  });

  it("conserves observed money and reconciles every real wallet against one durable primary witness", async () => {
    const { memory, input, db } = fixture();
    memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 2 }]);
    memory.seed("gameConfig", [{ _id: "default", moneySupplyEnabled: true }]);
    memory.seed("centralBanks", [{ _id: "US", countryId: "US", externalBroadMoney: 0 }]);
    memory
      .collection("producerEconomyAccounts")
      .docs.push({
        _id: "stale",
        worldEpoch: "other",
        cash: 1000000,
        currency: "USD",
        kind: "households",
      });
    const opening = await collectBalances(db);
    expect(opening).not.toHaveProperty("economy_wallet:stale:USD");
    await snapshotMoneySupply(db, 0);
    const before = memory.collection("moneySupplySnapshots").docs[0];
    await settleProducerTurn(db, input);
    const closing = await collectBalances(db);
    await snapshotMoneySupply(db, 1);
    const after = memory.collection("moneySupplySnapshots").docs.find((row) => row.turn === 1)!;
    expect(after.m2).toBe(before.m2);
    expect(after.householdLiquid).toBe(60);
    expect(after.corporateLiquid).toBe(1040);
    const entries = await db.collection<LedgerEntry>("ledgerEntries").find({}).toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].legs.every((leg) => leg.role === "primary")).toBe(true);
    expect(
      reconcileLedger({ turn: 1, entries, openingBalances: opening, closingBalances: closing })
        .status
    ).toBe("green");
    await settleProducerTurn(db, input);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(1);
  });

  it.each([false, true])(
    "recovers the cash witness after interruption, afterWrite=%s",
    async (afterWrite) => {
      const { memory, input, db } = fixture();
      const faulty = withInjectedCrash(memory, {
        collection: "ledgerEntries",
        op: "insertOne",
        onCall: 1,
        afterWrite,
      });
      await expect(settleProducerTurn(faulty.db, input)).rejects.toThrow("crash");
      expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1030);
      await settleProducerTurn(db, input);
      expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1030);
      expect(memory.collection("ledgerEntries").docs).toHaveLength(1);
    }
  );

  it.each([false, true])(
    "recovers publication after cash landed, afterWrite=%s",
    async (afterWrite) => {
      const { memory, input, db } = fixture();
      const faulty = withInjectedCrash(memory, {
        collection: "corporateSectors",
        op: "bulkWrite",
        onCall: 1,
        afterWrite,
      });
      await expect(settleProducerTurn(faulty.db, input)).rejects.toThrow("crash");
      expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1030);
      input.production.producers = input.production.producers.map((p) => ({
        ...p,
        capacityUnits: 1000,
      }));
      const result = await settleProducerTurn(db, input);
      expect(result.producers[0].producedUnits).toBe(10);
      expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1030);
      expect(memory.collection("corporateSectors").docs[0]).toMatchObject({
        producerSettlement: { producedUnits: 10, revenue: 30 },
      });
    }
  );

  it("recovers the frozen original quote when interrupted before cash", async () => {
    const { memory, input, db } = fixture();
    const faulty = withInjectedCrash(memory, {
      collection: "producerEconomyTurns",
      op: "insertOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settleProducerTurn(faulty.db, input)).rejects.toThrow("crash");
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
    input.production.producers = [];
    const result = await settleProducerTurn(db, input);
    expect(result.producers[0].revenue).toBe(30);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1030);
  });

  it("does not move cash when a frozen receipt chunk is missing", async () => {
    const { memory, input, db } = fixture();
    input.production.externalOrders = Array.from({ length: 129 }, (_, i) => ({
      id: `unused:${i}`,
      accountId: "households",
      commodity: "unused",
      book: "world",
      units: 0,
      maximumUnitPrice: 0,
    }));
    const faulty = withInjectedCrash(memory, {
      collection: "producerEconomyTurns",
      op: "insertOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settleProducerTurn(faulty.db, input)).rejects.toThrow("crash");
    expect(memory.collection("producerEconomyTurnChunks").docs.length).toBeGreaterThan(0);
    memory.collection("producerEconomyTurnChunks").docs.splice(0);
    await expect(settleProducerTurn(db, input)).rejects.toThrow("Missing producer receipt chunk");
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
  });

  it("rejects an unsupported native currency before freezing or moving cash", async () => {
    const { memory, input, db } = fixture();
    input.bindings = input.bindings.map((binding) => ({ ...binding, currency: "unvalued" }));
    await expect(settleProducerTurn(db, input)).rejects.toThrow("native ledger currency");
    expect(memory.collection("producerEconomyTurns").docs).toHaveLength(0);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
  });

  it("refuses a different turn fence before freezing or moving money", async () => {
    const { memory, input, db } = fixture();
    memory.collection("gameState").docs[0].processingTargetTurn = 2;
    await expect(settleProducerTurn(db, input)).rejects.toThrow("turn fence");
    expect(memory.collection("producerEconomyTurns").docs).toHaveLength(0);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
  });
});
