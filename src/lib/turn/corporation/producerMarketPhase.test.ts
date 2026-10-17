import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { producerPayableId } from "@/lib/market/producerMarket/payablesRules";
import { prepareProducerSector } from "./producerSectorPlan";
import {
  producerWalletId,
  runCorporationProducerMarket,
  type ProducerWalletScope,
} from "./producerMarketPhase";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function fixture() {
  const memory = createInMemoryDb();
  const corp = makeCorporation({
    liquidCapital: 1000,
    liquidCurrencyCode: "USD",
    producerPayables: { worldEpoch: "world", turn: 0, claims: [] },
  });
  const scopes: ProducerWalletScope[] = [
    { kind: "households", countryId: "US", stateId: "US_CA", currency: "USD" },
    { kind: "operatingPayee", countryId: "US", stateId: "US_CA", currency: "USD" },
  ];
  const household = producerWalletId("world", scopes[0]);
  const operating = producerWalletId("world", scopes[1]);
  const sector = {
    _id: new ObjectId(),
    corporationId: corp._id,
    sectorType: "financial" as const,
    capitalStock: (10 * TURNS_PER_DAY) / (1 - CAPITAL_DEPRECIATION_PER_TURN),
    capacityBookAnchor: 100,
    buildQueue: [],
    producerCapacity: { worldEpoch: "world", turn: 0 },
    producerInventory: { worldEpoch: "world", turn: 0, inputStock: [], outputStock: [] },
    producerQuotes: { financial_services: { kind: "manual" as const, unitPrice: 3 } },
  };
  memory.seed("gameState", [
    {
      _id: "current",
      worldEpochId: "world",
      isActive: true,
      processingKind: "turn",
      isProcessing: true,
      processingTargetTurn: 1,
    },
  ]);
  memory.seed("corporations", [{ ...corp }]);
  memory.seed("corporateSectors", [sector]);
  const input: Parameters<typeof runCorporationProducerMarket>[1] = {
    worldEpoch: "world",
    turn: 1,
    corporations: [corp],
    walletScopes: scopes,
    rates: new Map([["USD", 2]]),
    prepare: () => [
      prepareProducerSector({
        worldEpoch: "world",
        turn: 1,
        sector,
        recipe: { supply: { financial_services: 1 }, demand: {}, eraUnitScale: 1 },
        markets: new Map([
          [
            "financial_services",
            { book: "world", referenceUnitPrice: 3, maximumInputUnitPrice: 4 },
          ],
        ]),
        outputMultiplier: 1,
        operatingRecipeRatio: 1,
        recessionCapacityFactor: 1,
        labourCost: 10,
        otherOperatingCost: 5,
        labourRecipientAccountId: household,
        operatingRecipientAccountId: operating,
      }),
    ],
    demand: {
      households: [
        {
          accountId: household,
          spendFraction: 1,
          products: [
            { commodity: "financial_services", book: "world", maximumUnitPrice: 3, weight: 1 },
          ],
        },
      ],
    },
  };
  return { memory, corp, sector, household, operating, input, db: memory as unknown as Db };
}

describe("corporation producer market phase", () => {
  it.each([false, true])(
    "replays a retained-stock sale and its historical quote memo after a crash, afterWrite=%s",
    async (afterWrite) => {
      const { memory, corp, input, db, sector, household } = fixture();
      const stock = { commodity: "steel", book: "world", units: 5, quoteUnitCost: 2 };
      memory.collection("corporateSectors").docs[0].producerInventory = {
        ...sector.producerInventory,
        outputStock: [stock],
      };
      const prepared = input.prepare();
      prepared[0].plan.outputStock = [stock];
      prepared[0].plan.outputs = [
        ...prepared[0].plan.outputs,
        {
          commodity: "steel",
          book: "world",
          unitsPerOutput: 0,
          referenceUnitPrice: 9,
          retainedUnitCost: 2,
          policy: { kind: "costPlus", markup: 0.5 },
          storable: true,
        },
      ];
      input.prepare = () => prepared;
      input.demand = {
        externalOrders: [
          {
            id: "old-goods-customer",
            accountId: household,
            commodity: "steel",
            book: "world",
            units: 2,
            maximumUnitPrice: 3,
          },
        ],
      };
      const faulty = withInjectedCrash(memory, {
        collection: "corporateSectors",
        op: "bulkWrite",
        onCall: 1,
        afterWrite,
      });
      await expect(runCorporationProducerMarket(faulty.db, input)).rejects.toThrow("crash");
      input.prepare = () => {
        throw new Error("Must replay the original stock and quote");
      };
      input.rates = new Map([["USD", 7]]);
      const result = await runCorporationProducerMarket(db, input);
      expect(corp.liquidCapital).toBe(982);
      expect(result.operatingByCorporation.get(corp._id.toHexString())).toMatchObject({
        revenue: 6,
        expenses: 15,
        profit: -9,
        cashFlow: -9,
      });
      const closingStock = result.closingSectors[0].producerInventory?.outputStock.find(
        (row) => row.commodity === "steel"
      );
      expect(closingStock).toMatchObject({ units: expect.closeTo(2.994, 10), quoteUnitCost: 2 });
      await runCorporationProducerMarket(db, input);
      expect(corp.liquidCapital).toBe(982);
      expect(memory.collection("ledgerEntries").docs).toHaveLength(1);
    }
  );

  it("funds purchases with paid wages and refreshes actual native cash without creating buyer money", async () => {
    const { memory, corp, input, db } = fixture();
    const settled = await runCorporationProducerMarket(db, input);
    expect(settled.operatingByCorporation.get(corp._id.toHexString())).toMatchObject({
      revenue: expect.closeTo(10, 10),
      expenses: 15,
      profit: expect.closeTo(-5, 10),
      cashFlow: -5,
    });
    expect(corp.liquidCapital).toBe(990);
    const wallets = memory.collection("producerEconomyAccounts").docs;
    expect(wallets).toHaveLength(2);
    expect(wallets.reduce((sum, wallet) => sum + Number(wallet.cash), 0) + corp.liquidCapital).toBe(
      1000
    );
    expect(settled.closingSectors[0].producerCapacity?.turn).toBe(1);
    expect(memory.collection("ledgerEntries").docs).toHaveLength(1);
  });

  it.each([false, true])(
    "resumes before preparing already-advanced sectors, afterWrite=%s",
    async (afterWrite) => {
      const { memory, corp, input, db } = fixture();
      const faulty = withInjectedCrash(memory, {
        collection: "corporateSectors",
        op: "bulkWrite",
        onCall: 1,
        afterWrite,
      });
      await expect(runCorporationProducerMarket(faulty.db, input)).rejects.toThrow("crash");
      input.prepare = () => {
        throw new Error("Must not prepare a frozen turn");
      };
      input.rates = new Map([["USD", 5]]);
      const settled = await runCorporationProducerMarket(db, input);
      expect(corp.liquidCapital).toBe(990);
      expect(settled.operatingByCorporation.get(corp._id.toHexString())?.cashFlow).toBe(-5);
      await runCorporationProducerMarket(db, input);
      expect(corp.liquidCapital).toBe(990);
      expect(memory.collection("ledgerEntries").docs).toHaveLength(1);
      expect(memory.collection("producerEconomyAccounts").docs).toHaveLength(2);
    }
  );

  it("retains the cash cost of old creditors after the producing site closed, without repeating the expense", async () => {
    const { memory, corp, input, household, db } = fixture();
    corp.liquidCapital = 20;
    const claim = {
      debtorAccountId: corp._id.toHexString(),
      creditorAccountId: household,
      producerId: "closed-site",
      kind: "labour" as const,
      amount: 15,
    };
    memory.collection("corporations").docs[0].liquidCapital = 20;
    memory.collection("corporations").docs[0].producerPayables = {
      worldEpoch: "world",
      turn: 0,
      claims: [{ ...claim, id: producerPayableId(claim) }],
    };
    input.prepare = () => [];
    input.demand = {};
    const settled = await runCorporationProducerMarket(db, input);
    expect(corp.liquidCapital).toBe(0);
    expect(corp.producerPayables?.claims[0].amount).toBe(5);
    expect(settled.operatingByCorporation.get(corp._id.toHexString())).toEqual({
      revenue: 0,
      expenses: 0,
      profit: 0,
      cashFlow: -10,
    });
  });

  it.each([
    { isProcessing: false },
    { isActive: false },
    { processingKind: "stockTaxMigration" },
    { processingKind: null },
    { processingTargetTurn: 2 },
    { worldEpochId: "replaced-world" },
  ])("refuses to create counterparties outside the active world turn: %j", async (state) => {
    const { memory, input, db } = fixture();
    Object.assign(memory.collection("gameState").docs[0], state);
    await expect(runCorporationProducerMarket(db, input)).rejects.toThrow("turn fence");
    expect(memory.collection("producerEconomyAccounts").docs).toHaveLength(0);
    expect(memory.collection("producerEconomyTurns").docs).toHaveLength(0);
  });

  it("refreshes a stale host balance and preserves an opening overdraft as unpaid work accrues", async () => {
    const { memory, corp, input, db } = fixture();
    memory.collection("corporations").docs[0].liquidCapital = -20;
    const settled = await runCorporationProducerMarket(db, input);
    expect(corp.liquidCapital).toBe(-20);
    expect(settled.operatingByCorporation.get(corp._id.toHexString())).toEqual({
      revenue: 0,
      expenses: 15,
      profit: -15,
      cashFlow: 0,
    });
    expect(corp.producerPayables?.claims.reduce((sum, claim) => sum + claim.amount, 0)).toBe(15);
    expect(
      memory.collection("producerEconomyAccounts").docs.every((wallet) => wallet.cash === 0)
    ).toBe(true);
  });
});
