import { producerPayableId } from "./payablesRules";
import { corporateCashArrearsAnchor } from "@/lib/bonds/rules/cashArrears";
import { describe, expect, it } from "vitest";
import { planProducerOpening, type ExistingWorldProducerOpening } from "./migrationRules";

const opening = (): ExistingWorldProducerOpening => ({
  worldEpoch: "example-world",
  completedTurn: 10,
  processing: false,
  modeledLossPolicy: { kind: "unresolved" },
  corporations: [
    {
      id: "a",
      currency: "USD",
      localPerAnchor: 2,
      cash: 100,
      operatingArrearsAnchor: 0,
      modeledLossCarry: [],
      payables: [],
    },
    {
      id: "b",
      currency: "JPY",
      localPerAnchor: 100,
      cash: -200,
      operatingArrearsAnchor: 0,
      modeledLossCarry: [],
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

  it.each([25, -0.0025])(
    "keeps signed historical modeled carry out of supplier claims: %s",
    (amountAnchor) => {
      const source = opening();
      source.corporations[0].modeledLossCarry = [
        { currency: "USD", amountLocal: amountAnchor * 2, localPerAnchor: 2 },
      ];
      const plan = planProducerOpening(source);
      expect(plan.unresolvedModeledLossCarry).toEqual([{ accountId: "a", amountAnchor }]);
      expect(plan.accounts[0].producerPayables.claims).toEqual([]);
      expect(plan.requiredCreditorAccountIds).toEqual([]);
      expect(plan.accounts[0].openingCashLocal).toBe(100);
    }
  );

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

  it.each([25, -0.0025])("audits the non-cash removal of signed modeled carry: %s", (carry) => {
    const source = opening();
    source.modeledLossPolicy = { kind: "openingAdjustment", approvalReference: "opening-review-1" };
    source.corporations[0].modeledLossCarry = [
      { currency: "USD", amountLocal: carry * 2, localPerAnchor: 2 },
    ];
    const claim = {
      debtorAccountId: "a",
      creditorAccountId: "workers",
      producerId: "closed-site",
      kind: "labour" as const,
      amount: 15,
    };
    source.corporations[0].operatingArrearsAnchor = 15;
    source.corporations[0].payables = [{ ...claim, id: producerPayableId(claim) }];
    source.protectedImages = [
      { key: "loans", digest: "loan-before-image" },
      { key: "recorded-tax-debts", digest: "tax-before-image" },
    ];
    const before = structuredClone(source);
    const plan = planProducerOpening(source);
    expect(source).toEqual(before);
    expect(plan.unresolvedModeledLossCarry).toEqual([]);
    expect(plan.nonCashOpeningAdjustments).toEqual([
      {
        kind: "modeledOperatingLossReconciliation",
        accountId: "a",
        originalModeledLossCarry: source.corporations[0].modeledLossCarry,
        originalModeledLossCarryAnchor: carry,
        recognizedLiabilityAnchor: Math.max(0, carry),
        liabilityDeltaAnchor: carry > 0 ? -carry : 0,
        equityDeltaAnchor: Math.max(0, carry),
        cashDeltaLocal: 0,
        operatingIncomeDeltaAnchor: 0,
        taxableProfitDeltaAnchor: 0,
        approvalReference: "opening-review-1",
      },
    ]);
    expect(plan.accounts.map((account) => account.openingCashLocal)).toEqual([100, -200]);
    expect(plan.accounts[0].producerPayables.claims).toEqual(source.corporations[0].payables);
    expect(plan.requiredCreditorAccountIds).toEqual(["workers"]);
    expect(plan.protectedImages).toEqual(source.protectedImages);
    expect(plan.reconciliation).toMatchObject({
      modeledLossCarryRemovedAnchor: carry,
      openingLiabilityDeltaAnchor: carry > 0 ? -carry : 0,
      openingEquityDeltaAnchor: Math.max(0, carry),
      cashCreated: 0,
      operatingArrearsForgiven: 0,
      operatingArrearsAnchor: 15,
    });
  });

  it("requires a recorded approval and reconciles every signed adjustment independently", () => {
    const source = opening();
    source.modeledLossPolicy = { kind: "openingAdjustment", approvalReference: "  " };
    expect(() => planProducerOpening(source)).toThrow("explicit audited decision");
    source.modeledLossPolicy = { kind: "openingAdjustment", approvalReference: "opening-review-1" };
    source.corporations[0].modeledLossCarry = [
      { currency: "USD", amountLocal: 50, localPerAnchor: 2 },
    ];
    source.corporations[1].modeledLossCarry = [
      { currency: "JPY", amountLocal: -0.25, localPerAnchor: 100 },
    ];
    const plan = planProducerOpening(source);
    expect(plan.nonCashOpeningAdjustments).toHaveLength(2);
    expect(plan.reconciliation.modeledLossCarryRemovedAnchor).toBeCloseTo(24.9975);
    expect(plan.reconciliation.openingEquityDeltaAnchor).toBe(25);
    expect(
      plan.nonCashOpeningAdjustments.every(
        (row) => row.liabilityDeltaAnchor + row.equityDeltaAnchor === 0
      )
    ).toBe(true);
    expect(
      planProducerOpening({ ...source, corporations: [...source.corporations].reverse() })
    ).toEqual(plan);
  });

  it("does not net a negative currency residue against a recognized positive liability", () => {
    const source = opening();
    source.modeledLossPolicy = { kind: "openingAdjustment", approvalReference: "opening-review-1" };
    source.corporations[0].modeledLossCarry = [
      { currency: "USD", amountLocal: 50, localPerAnchor: 2 },
      { currency: "JPY", amountLocal: -2500, localPerAnchor: 100 },
    ];
    const recognized = corporateCashArrearsAnchor({
      operatingByCurrency: { USD: 50, JPY: -2500 },
      fxByCurrency: new Map([
        ["USD", 2],
        ["JPY", 100],
      ]),
    });
    const plan = planProducerOpening(source);
    expect(plan.nonCashOpeningAdjustments).toHaveLength(1);
    expect(plan.reconciliation.modeledLossCarryRemovedAnchor).toBe(0);
    expect(plan.reconciliation.openingLiabilityDeltaAnchor).toBe(-recognized);
    expect(plan.reconciliation.openingEquityDeltaAnchor).toBe(recognized);
    expect(recognized).toBe(25);
    source.modeledLossPolicy = { kind: "unresolved" };
    expect(planProducerOpening(source).unresolvedModeledLossCarry).toEqual([
      { accountId: "a", amountAnchor: 0 },
    ]);
  });

  it.each([0, -1, NaN, Infinity])("refuses an unvalued carry currency: %s", (rate) => {
    const source = opening();
    source.corporations[0].modeledLossCarry = [
      { currency: "JPY", amountLocal: 50, localPerAnchor: rate },
    ];
    expect(() => planProducerOpening(source)).toThrow();
  });

  it("refuses inconsistent FX or duplicate carry entries before granting an adjustment", () => {
    const source = opening();
    source.modeledLossPolicy = { kind: "openingAdjustment", approvalReference: "opening-review-1" };
    source.corporations[0].modeledLossCarry = [
      { currency: "USD", amountLocal: 50, localPerAnchor: 1 },
    ];
    expect(() => planProducerOpening(source)).toThrow("Inconsistent frozen currency rate");
    source.corporations[0].modeledLossCarry = [
      { currency: "USD", amountLocal: 25, localPerAnchor: 2 },
      { currency: "USD", amountLocal: 25, localPerAnchor: 2 },
    ];
    expect(() => planProducerOpening(source)).toThrow("Duplicate");
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
