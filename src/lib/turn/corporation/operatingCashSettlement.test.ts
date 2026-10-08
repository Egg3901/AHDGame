import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import type { CorpSnapshot } from "./types";
import { settleCorporateOperatingCash } from "./operatingCashSettlement";

function snapshot(
  corpId: ObjectId,
  input: Partial<
    Pick<
      CorpSnapshot,
      | "operatingCashIncomeLocal"
      | "operatingCashCurrency"
      | "operatingCashLocalPerAnchor"
      | "federalTaxByCountryAnchor"
    >
  >
): CorpSnapshot {
  return {
    corpId,
    revenue: 100,
    totalCosts: 0,
    incomePreDividends: 80,
    income: 80,
    perTurnBondCouponIncome: 0,
    perTurnBondInterestExpense: 0,
    perTurnBondDragOnNetIncome: 0,
    liquidCapitalAnchorAfterIncome: 180,
    dividendPaidPerTurn: 0,
    federalTaxPaid: 20,
    stateTaxPaid: 0,
    taxPaidByCountry: input.federalTaxByCountryAnchor ?? new Map(),
    taxPaidByState: new Map(),
    taxPaidByCountryDomestic: new Map(),
    taxPaidByCountryForeign: new Map(),
    taxPaidByStateDomestic: new Map(),
    taxPaidByStateForeign: new Map(),
    marketingStrength: 0,
    logisticsStrength: 0,
    rdScore: 0,
    dividendRate: 0,
    liquidCapital: 180,
    escrowFundingMove: 0,
    escrowBalanceAfter: 0,
    actualSharePrice: 1,
    totalShares: 100,
    sectorNPV: 0,
    creditComposite: 50,
    creditRating: "B",
    ...input,
  };
}

describe("corporate operating cash settlement", () => {
  it("credits modeled gross cash, withholds federal tax, and preserves net corporate income once", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000030");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      {
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        treasuryCashLocal: 100,
        treasuryBalance: -50,
      },
    ]);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 100 }]);

    const operating = snapshot(corpId, {
      operatingCashIncomeLocal: 80,
      operatingCashCurrency: "USD",
      operatingCashLocalPerAnchor: 1,
      federalTaxByCountryAnchor: new Map([["US", 20]]),
    });
    await settleCorporateOperatingCash(db as unknown as Db, [operating], 4, new Date());
    await settleCorporateOperatingCash(db as unknown as Db, [operating], 4, new Date());

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(180);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 120,
      treasuryBalance: -30,
    });
    // Profitable, solvent and with no payables: one receipt mints gross and
    // pays the corporation its net and the Treasury its tax.
    expect(db.collection("bankMoneyMoves").docs).toEqual([
      expect.objectContaining({
        kind: "corporate_operating_net_batch",
        status: "applied",
      }),
    ]);
  });

  it("settles solvent corporations owing the same Treasury in one receipt and keeps payables out", async () => {
    const db = createInMemoryDb();
    const ids = [41, 42, 43, 44, 45].map((n) => new ObjectId(`6500000000000000000000${n}`));
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      { _id: "US", countryId: "US", currencyCode: "USD", treasuryCashLocal: 0, treasuryBalance: 0 },
    ]);
    db.seed("corporations", [
      ...ids.slice(0, 4).map((_id) => ({ _id, liquidCapital: 10 })),
      // Owes prior tax: settles through its own receipts, after the payable.
      { _id: ids[4], liquidCapital: 10, federalTaxArrearsAnchorByCountry: { US: 5 } },
    ]);

    const snapshots = ids.map((corpId) =>
      snapshot(corpId, {
        operatingCashIncomeLocal: 80,
        operatingCashCurrency: "USD",
        operatingCashLocalPerAnchor: 1,
        federalTaxByCountryAnchor: new Map([["US", 20]]),
      })
    );
    await settleCorporateOperatingCash(db as unknown as Db, snapshots, 4, new Date());
    await settleCorporateOperatingCash(db as unknown as Db, snapshots, 4, new Date());

    const cash = (id: ObjectId) =>
      db.collection("corporations").docs.find((doc) => String(doc._id) === String(id))
        ?.liquidCapital;
    for (const id of ids.slice(0, 4)) expect(cash(id)).toBe(90);
    // 10 + 100 gross - 5 prior tax - 20 current tax.
    expect(cash(ids[4])).toBe(85);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 105,
      treasuryBalance: 105,
    });
    const kinds = db.collection("bankMoneyMoves").docs.map((doc) => doc.kind);
    expect(kinds.filter((kind) => kind === "corporate_operating_net_batch")).toHaveLength(1);
    expect(kinds).toContain("corporate_tax_withholding");
  });

  it("finishes a crashed batch on retry and never settles its members again", async () => {
    const db = createInMemoryDb();
    const ids = [51, 52, 53, 54].map((n) => new ObjectId(`6500000000000000000000${n}`));
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      { _id: "US", countryId: "US", currencyCode: "USD", treasuryCashLocal: 0, treasuryBalance: 0 },
    ]);
    db.seed(
      "corporations",
      ids.map((_id) => ({ _id, liquidCapital: 0 }))
    );
    const quoted = (income: number, tax: number) =>
      ids.map((corpId) =>
        snapshot(corpId, {
          operatingCashIncomeLocal: income,
          operatingCashCurrency: "USD",
          operatingCashLocalPerAnchor: 1,
          federalTaxByCountryAnchor: new Map([["US", tax]]),
        })
      );
    const fault = withInjectedCrash(db, {
      collection: "corporations",
      op: "bulkWrite",
      afterWrite: true,
      onCall: 1,
    });
    await expect(
      settleCorporateOperatingCash(fault.db, quoted(80, 20), 4, new Date())
    ).rejects.toThrow("crash after");
    fault.disarm();
    // The retry recomputed income and tax; the claimed batch still owns its
    // members, so the frozen amounts land once and nothing new is settled.
    await settleCorporateOperatingCash(fault.db, quoted(5_000, 900), 4, new Date());
    await settleCorporateOperatingCash(fault.db, quoted(5_000, 900), 4, new Date());

    for (const doc of db.collection("corporations").docs) expect(doc.liquidCapital).toBe(80);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 80,
      treasuryBalance: 80,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
  });

  it("keeps the gross then tax receipts when cash starts below zero", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000035");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      { _id: "US", countryId: "US", currencyCode: "USD", treasuryCashLocal: 0, treasuryBalance: 0 },
    ]);
    db.seed("corporations", [{ _id: corpId, liquidCapital: -90 }]);

    await settleCorporateOperatingCash(
      db as unknown as Db,
      [
        snapshot(corpId, {
          operatingCashIncomeLocal: 5,
          operatingCashCurrency: "USD",
          operatingCashLocalPerAnchor: 1,
          federalTaxByCountryAnchor: new Map([["US", 20]]),
        }),
      ],
      4,
      new Date()
    );

    // Gross 25 lands first; -65 cannot fund the 20 withholding, so the tax
    // becomes arrears exactly as before.
    expect(db.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: -65,
      federalTaxArrearsAnchorByCountry: { US: 20 },
    });
    expect(db.collection("federalBudget").docs[0]).toMatchObject({ treasuryCashLocal: 0 });
    expect(
      db
        .collection("bankMoneyMoves")
        .docs.map((doc) => [doc.kind, doc.status])
        .sort()
    ).toEqual([
      ["corporate_operating_gross_receipt", "applied"],
      ["corporate_tax_arrears", "applied"],
      ["corporate_tax_withholding", "rejected"],
    ]);
  });

  it("values split tax receipts in each native Treasury currency", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000031");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [
      { currencyCode: "EUR", rate: 2 },
      { currencyCode: "USD", rate: 1 },
      { currencyCode: "GBP", rate: 0.8 },
    ]);
    db.seed("federalBudget", [
      {
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        treasuryCashLocal: 10,
        treasuryBalance: 0,
      },
      {
        _id: "UK",
        countryId: "UK",
        currencyCode: "GBP",
        treasuryCashLocal: 10,
        treasuryBalance: 0,
      },
    ]);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 100 }]);

    await settleCorporateOperatingCash(
      db as unknown as Db,
      [
        snapshot(corpId, {
          operatingCashIncomeLocal: 40,
          operatingCashCurrency: "EUR",
          operatingCashLocalPerAnchor: 2,
          federalTaxByCountryAnchor: new Map([
            ["US", 4],
            ["UK", 6],
          ]),
        }),
      ],
      4,
      new Date()
    );

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(140);
    const budgets = db.collection("federalBudget").docs;
    const usBudget = budgets.find((budget) => budget.countryId === "US");
    const ukBudget = budgets.find((budget) => budget.countryId === "UK");
    expect(usBudget?.treasuryCashLocal).toBe(14);
    expect(usBudget?.treasuryBalance).toBe(4);
    expect(ukBudget?.treasuryCashLocal).toBeCloseTo(14.8);
    expect(ukBudget?.treasuryBalance).toBeCloseTo(4.8);
  });

  it("records losses beyond current liquid funds as operating arrears", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000033");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", []);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 5 }]);

    await expect(
      settleCorporateOperatingCash(
        db as unknown as Db,
        [
          snapshot(corpId, {
            operatingCashIncomeLocal: -100,
            operatingCashCurrency: "USD",
            operatingCashLocalPerAnchor: 1,
            federalTaxByCountryAnchor: new Map(),
          }),
        ],
        4,
        new Date()
      )
    ).resolves.toBeUndefined();

    // The former guard could abort corporationTurn for ordinary insolvency.
    // Cash remains nonnegative and the unpaid loss is recorded as a payable.
    expect(db.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: 0,
      operatingCashArrearsByCurrency: { USD: 95 },
    });
    expect(db.collection("bankMoneyMoves").docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: `corp-operating-cash:4:${corpId.toHexString()}:gross`,
          status: "applied",
        }),
      ])
    );
  });

  it("records tax that cannot be withheld after an unfunded loss without aborting the turn", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000035");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      { _id: "US", countryId: "US", treasuryCashLocal: 0, treasuryBalance: 0 },
    ]);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 5 }]);

    await expect(
      settleCorporateOperatingCash(
        db as unknown as Db,
        [
          snapshot(corpId, {
            operatingCashIncomeLocal: -100,
            operatingCashCurrency: "USD",
            operatingCashLocalPerAnchor: 1,
            federalTaxByCountryAnchor: new Map([["US", 20]]),
          }),
        ],
        4,
        new Date()
      )
    ).resolves.toBeUndefined();

    expect(db.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: 0,
      operatingCashArrearsByCurrency: { USD: 75 },
      federalTaxArrearsAnchorByCountry: { US: 20 },
    });
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 0,
      treasuryBalance: 0,
    });
  });

  it("services prior operating arrears from later gross income and resumes a payment crash once", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000036");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 1, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", []);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 5 }]);

    await settleCorporateOperatingCash(
      db as unknown as Db,
      [
        snapshot(corpId, {
          operatingCashIncomeLocal: -100,
          operatingCashCurrency: "USD",
          operatingCashLocalPerAnchor: 1,
          federalTaxByCountryAnchor: new Map(),
        }),
      ],
      1,
      new Date()
    );
    expect(db.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: 0,
      operatingCashArrearsByCurrency: { USD: 95 },
      operatingCashArrearsLastTurnByCurrency: { USD: 1 },
    });

    const fault = withInjectedCrash(db, {
      collection: "corporations",
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.liquidCapital === -95;
      },
    });
    await expect(
      settleCorporateOperatingCash(
        fault.db,
        [
          snapshot(corpId, {
            operatingCashIncomeLocal: 200,
            operatingCashCurrency: "USD",
            operatingCashLocalPerAnchor: 1,
            federalTaxByCountryAnchor: new Map(),
          }),
        ],
        2,
        new Date()
      )
    ).rejects.toThrow("crash after");
    fault.disarm();

    await settleCorporateOperatingCash(
      fault.db,
      [
        snapshot(corpId, {
          operatingCashIncomeLocal: 9_999,
          operatingCashCurrency: "USD",
          operatingCashLocalPerAnchor: 1,
          federalTaxByCountryAnchor: new Map(),
        }),
      ],
      2,
      new Date()
    );

    expect(db.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: 105,
      operatingCashArrearsByCurrency: { USD: 0 },
      operatingCashArrearsLastTurnByCurrency: { USD: 2 },
    });
    expect(db.collection("bankMoneyMoves").docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: `corp-operating-arrears-settle:${corpId.toHexString()}:2`,
          status: "applied",
        }),
      ])
    );
  });

  it("delivers prior tax arrears from later gross cash and resumes the frozen Treasury receipt", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000037");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 1, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      { _id: "US", countryId: "US", treasuryCashLocal: 0, treasuryBalance: 0 },
    ]);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 5 }]);

    await settleCorporateOperatingCash(
      db as unknown as Db,
      [
        snapshot(corpId, {
          operatingCashIncomeLocal: -100,
          operatingCashCurrency: "USD",
          operatingCashLocalPerAnchor: 1,
          federalTaxByCountryAnchor: new Map([["US", 20]]),
        }),
      ],
      1,
      new Date()
    );
    expect(db.collection("corporations").docs[0]).toMatchObject({
      operatingCashArrearsByCurrency: { USD: 75 },
      federalTaxArrearsAnchorByCountry: { US: 20 },
    });

    const fault = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.treasuryCashLocal === 20;
      },
    });
    const laterIncome = snapshot(corpId, {
      operatingCashIncomeLocal: 150,
      operatingCashCurrency: "USD",
      operatingCashLocalPerAnchor: 1,
      federalTaxByCountryAnchor: new Map(),
    });
    await expect(
      settleCorporateOperatingCash(fault.db, [laterIncome], 2, new Date())
    ).rejects.toThrow("crash after");
    fault.disarm();

    await settleCorporateOperatingCash(
      fault.db,
      [
        snapshot(corpId, {
          operatingCashIncomeLocal: 9_999,
          operatingCashCurrency: "USD",
          operatingCashLocalPerAnchor: 1,
          federalTaxByCountryAnchor: new Map(),
        }),
      ],
      2,
      new Date()
    );

    expect(db.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: 55,
      operatingCashArrearsByCurrency: { USD: 0 },
      federalTaxArrearsAnchorByCountry: { US: 0 },
      federalTaxArrearsLastTurnByCountry: { US: 2 },
    });
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 20,
      treasuryBalance: 20,
    });
    expect(db.collection("bankMoneyMoves").docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: `corp-tax-arrears-settle:${corpId.toHexString()}:2`,
          status: "applied",
        }),
      ])
    );
  });

  it("settles current turn operating cash after an earlier share escrow debit", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000034");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      { _id: "US", countryId: "US", treasuryCashLocal: 0, treasuryBalance: 0 },
    ]);
    // corporationTurn has already applied the 90-unit share escrow debit.
    db.seed("corporations", [{ _id: corpId, liquidCapital: 10, shareEscrowBalance: 90 }]);

    await settleCorporateOperatingCash(
      db as unknown as Db,
      [
        snapshot(corpId, {
          operatingCashIncomeLocal: 80,
          operatingCashCurrency: "USD",
          operatingCashLocalPerAnchor: 1,
          federalTaxByCountryAnchor: new Map([["US", 20]]),
        }),
      ],
      4,
      new Date()
    );

    expect(db.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: 90,
      shareEscrowBalance: 90,
    });
    expect(db.collection("federalBudget").docs[0]).toMatchObject({ treasuryCashLocal: 20 });
  });

  it.each([
    // Split protocol (cash starts below zero): gross, then tax.
    ["split payer debit", "corporations", "liquidCapital", -20, -1, 2],
    ["split Treasury credit", "federalBudget", "treasuryCashLocal", 20, -1, 2],
    // Combined receipt: net to the corporation, tax to the Treasury.
    ["net corporation credit", "corporations", "liquidCapital", 80, 100, 1],
    ["net Treasury credit", "federalBudget", "treasuryCashLocal", 20, 100, 1],
  ])(
    "replays a crash after the %s leg without recalculating or duplicating cash",
    async (_label, collection, path, amount, startingCash, moves) => {
      const db = createInMemoryDb();
      const corpId = new ObjectId("650000000000000000000032");
      db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
      db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
      db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
      db.seed("federalBudget", [
        {
          _id: "US",
          countryId: "US",
          currencyCode: "USD",
          treasuryCashLocal: 100,
          treasuryBalance: 0,
        },
      ]);
      db.seed("corporations", [{ _id: corpId, liquidCapital: startingCash }]);
      const original = snapshot(corpId, {
        operatingCashIncomeLocal: 80,
        operatingCashCurrency: "USD",
        operatingCashLocalPerAnchor: 1,
        federalTaxByCountryAnchor: new Map([["US", 20]]),
      });
      const fault = withInjectedCrash(db, {
        collection,
        op: "updateOne",
        afterWrite: true,
        onCall: 1,
        matches: (args) => {
          const update = args[1] as { $inc?: Record<string, number> };
          return update.$inc?.[path] === amount;
        },
      });

      await expect(
        settleCorporateOperatingCash(fault.db, [original], 4, new Date())
      ).rejects.toThrow("crash after");
      fault.disarm();
      // A turn retry may have recomputed operating income and tax. The claimed
      // receipt must finish from the original per-country native-currency quote.
      const recomputed = snapshot(corpId, {
        operatingCashIncomeLocal: 5_000,
        operatingCashCurrency: "USD",
        operatingCashLocalPerAnchor: 1,
        federalTaxByCountryAnchor: new Map([["US", 900]]),
      });
      await settleCorporateOperatingCash(fault.db, [recomputed], 4, new Date());
      await settleCorporateOperatingCash(fault.db, [recomputed], 4, new Date());

      expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(startingCash + 80);
      expect(db.collection("federalBudget").docs[0]).toMatchObject({
        treasuryCashLocal: 120,
        treasuryBalance: 20,
      });
      expect(db.collection("bankMoneyMoves").docs).toHaveLength(moves);
      expect(db.collection("bankMoneyMoves").docs).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: "applied" })])
      );
    }
  );

  it("resumes the frozen complete quote after gross cash lands even if the retry quote is missing", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000033");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      {
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        treasuryCashLocal: 0,
        treasuryBalance: 0,
      },
    ]);
    // Below-zero opening cash keeps the split gross then tax protocol.
    db.seed("corporations", [{ _id: corpId, liquidCapital: -1 }]);
    const original = snapshot(corpId, {
      operatingCashIncomeLocal: 80,
      operatingCashCurrency: "USD",
      operatingCashLocalPerAnchor: 1,
      federalTaxByCountryAnchor: new Map([["US", 20]]),
    });
    const fault = withInjectedCrash(db, {
      collection: "corporations",
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.liquidCapital === 100;
      },
    });

    await expect(settleCorporateOperatingCash(fault.db, [original], 4, new Date())).rejects.toThrow(
      "crash after"
    );
    fault.disarm();
    await db.collection("exchangeRates").updateOne({ currencyCode: "USD" }, { $set: { rate: 8 } });

    await settleCorporateOperatingCash(fault.db, [snapshot(corpId, {})], 4, new Date());

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(79);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 20,
      treasuryBalance: 20,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(2);
  });
});
