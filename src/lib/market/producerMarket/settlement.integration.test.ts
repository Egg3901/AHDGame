import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
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
    { _id: "households", worldEpoch: "example", cash: 100 },
    { _id: "operating", worldEpoch: "example", cash: 0 },
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

  it("refuses a different turn fence before freezing or moving money", async () => {
    const { memory, input, db } = fixture();
    memory.collection("gameState").docs[0].processingTargetTurn = 2;
    await expect(settleProducerTurn(db, input)).rejects.toThrow("turn fence");
    expect(memory.collection("producerEconomyTurns").docs).toHaveLength(0);
    expect(memory.collection("corporations").docs[0].liquidCapital).toBe(1000);
  });
});
