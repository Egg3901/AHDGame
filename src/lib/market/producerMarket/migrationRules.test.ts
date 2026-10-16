import { producerPayableId } from "./payablesRules";
import { describe, expect, it } from "vitest";
import { planProducerOpening, type ExistingWorldProducerOpening } from "./migrationRules";

const opening = (): ExistingWorldProducerOpening => ({
  worldEpoch: "example-world",
  completedTurn: 10,
  processing: false,
  corporations: [
    {
      id: "a",
      currency: "USD",
      localPerAnchor: 2,
      cash: 100,
      operatingArrearsAnchor: 0,
      payables: [],
    },
    {
      id: "b",
      currency: "JPY",
      localPerAnchor: 100,
      cash: -200,
      operatingArrearsAnchor: 0,
      payables: [],
    },
  ],
  sectors: [
    {
      id: "plant",
      accountId: "a",
      capacity: {
        ownedDailyUnits: 240,
        paidBookAnchor: 300,
        buildQueue: [
          { unitsOrdered: 60, costPaidAnchor: 90, startTurn: 8, onlineTurn: 12, smooth: true },
        ],
      },
      inventoryDailyUnits: { steel: 240 },
      inventoryValueAnchor: 480,
      pricingMode: "market",
      pricingPosture: 0.2,
      outputs: [{ commodity: "steel", book: "world", referenceUnitPrice: 2, storable: true }],
    },
  ],
  protectedImages: [{ key: "bank-principal", digest: "unchanged" }],
});

describe("existing-world producer opening", () => {
  it("preserves signed native cash, freezes FX and keeps an overdraft outside spendable funds", () => {
    const plan = planProducerOpening(opening());
    expect(plan.accounts).toEqual([
      {
        id: "a",
        currency: "USD",
        localPerAnchor: 2,
        openingCashLocal: 100,
        openingCashAnchor: 50,
        spendableCashAnchor: 50,
        openingOverdraftAnchor: 0,
        producerPayables: { worldEpoch: "example-world", turn: 10, claims: [] },
      },
      {
        id: "b",
        currency: "JPY",
        localPerAnchor: 100,
        openingCashLocal: -200,
        openingCashAnchor: -2,
        spendableCashAnchor: 0,
        openingOverdraftAnchor: 2,
        producerPayables: { worldEpoch: "example-world", turn: 10, claims: [] },
      },
    ]);
    expect(plan.reconciliation).toMatchObject({
      signedCashAnchor: 48,
      spendableCashAnchor: 50,
      overdraftAnchor: 2,
      cashCreated: 0,
      inputStockCreated: 0,
    });
    expect(plan.reconciliation.cashByCurrency).toEqual([
      { currency: "JPY", before: -200, after: -200 },
      { currency: "USD", before: 100, after: 100 },
    ]);
    expect(plan.firstSettlementTurn).toBe(11);
    expect(plan.sectors[0].capacity).toEqual({
      ...opening().sectors[0].capacity,
      completedTurn: 10,
    });
    expect(plan.reconciliation).toMatchObject({
      ownedDailyUnits: 240,
      paidCapacityBookAnchor: 300,
      constructionInProgressAnchor: 45,
    });
    expect(plan.protectedImages).toEqual(opening().protectedImages);
  });

  it("carries all named opening creditors without paying, expensing or forgiving their claims", () => {
    const source = opening();
    const claim = {
      debtorAccountId: "a",
      creditorAccountId: "workers",
      producerId: "closed-site",
      kind: "labour" as const,
      amount: 15,
    };
    source.corporations = [
      {
        ...source.corporations[0],
        operatingArrearsAnchor: 15,
        payables: [{ ...claim, id: producerPayableId(claim) }],
      },
    ];
    const plan = planProducerOpening(source);
    expect(plan.accounts[0].producerPayables.claims).toEqual(source.corporations[0].payables);
    expect(plan.accounts[0].openingCashLocal).toBe(100);
    expect(plan.requiredCreditorAccountIds).toEqual(["workers"]);
    expect(plan.reconciliation).toMatchObject({
      operatingArrearsAnchor: 15,
      operatingArrearsCreated: 0,
      operatingArrearsForgiven: 0,
    });
    source.corporations[0].operatingArrearsAnchor = 16;
    expect(() => planProducerOpening(source)).toThrow("complete creditor reconciliation");
    source.corporations[0].operatingArrearsAnchor = 0;
    expect(() => planProducerOpening(source)).toThrow("complete creditor reconciliation");
  });

  it("converts only retained inventory, never last turn's production or memo value into fresh wealth", () => {
    const plan = planProducerOpening(opening());
    expect(plan.sectors[0]).toMatchObject({
      inputStock: [],
      outputStock: [{ commodity: "steel", book: "world", units: 10 }],
      openingInventoryMemoValueAnchor: 20,
    });
    expect(plan.reconciliation.inventoryByCommodity).toEqual([
      { commodity: "steel", beforeDailyUnits: 240, afterTurnUnits: 10 },
    ]);
    expect(plan.sectors[0].quotes[0].policy).toEqual({ kind: "manual", unitPrice: 2.4 });
  });

  it("preserves quote intent for automatic and cost-plus pricing across all commodities", () => {
    const source = opening();
    const sector = source.sectors[0];
    const outputs = [
      { commodity: "financial_services", book: "world", referenceUnitPrice: 4, storable: false },
    ];
    const automatic = planProducerOpening({
      ...source,
      sectors: [{ ...sector, inventoryDailyUnits: {}, outputs, pricingPosture: null }],
    });
    expect(automatic.sectors[0].quotes[0].policy).toEqual({ kind: "automatic", targetMarkup: 0 });
    const cost = planProducerOpening({
      ...source,
      sectors: [
        {
          ...sector,
          inventoryDailyUnits: {},
          outputs,
          pricingMode: "costPlus",
          pricingPosture: -0.1,
        },
      ],
    });
    expect(cost.sectors[0].quotes[0].policy).toEqual({ kind: "costPlus", markup: -0.1 });
  });

  it("refuses a moving world, missing FX, duplicate ownership and unrecognized stock", () => {
    const source = opening();
    expect(() => planProducerOpening({ ...source, processing: true })).toThrow("idle world");
    expect(() =>
      planProducerOpening({
        ...source,
        corporations: [{ ...source.corporations[0], localPerAnchor: 0 }],
      })
    ).toThrow("valuation");
    expect(() =>
      planProducerOpening({
        ...source,
        corporations: [source.corporations[0], source.corporations[0]],
      })
    ).toThrow("Duplicate");
    expect(() =>
      planProducerOpening({ ...source, sectors: [{ ...source.sectors[0], accountId: "unknown" }] })
    ).toThrow("Unbound");
    expect(() =>
      planProducerOpening({
        ...source,
        sectors: [{ ...source.sectors[0], inventoryDailyUnits: { financial_services: 24 } }],
      })
    ).toThrow("reconciliation");
  });
});
