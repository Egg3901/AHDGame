import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { snapshotMoneySupply, MONEY_SUPPLY_SNAPSHOTS_COLLECTION } from "./snapshot";

let db: MockDb;

function cursorWith(docs: unknown[]) {
  return {
    toArray: async () => docs,
    sort: function (this: unknown) {
      return this;
    },
    limit: function (this: unknown) {
      return this;
    },
    project: function (this: unknown) {
      return this;
    },
    batchSize: function (this: unknown) {
      return this;
    },
  };
}

beforeEach(() => {
  db = createMockDb();
  db.collection("gameConfig");
  db.collection("centralBanks");
  db.collection("gameState");
  db.collection("characters");
  db.collection("npps");
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("politicalParties");
  db.collection("federalBudget");
  db.collection("indexFunds");
  db.collection("organizationFunds");
  db.collection("bonds");
  db.collection("states");
  db.collection("macroMetrics");
  db.collection(MONEY_SUPPLY_SNAPSHOTS_COLLECTION);

  db.collectionMocks.gameConfig.findOne.mockResolvedValue({ moneySupplyEnabled: true });
  db.collectionMocks.centralBanks.find.mockReturnValue(
    cursorWith([
      {
        _id: "US",
        countryId: "US",
        externalBroadMoney: 240_000_000_000,
        netMoneyCreatedLifetime: 0,
        reserveBalance: 1_000_000,
      },
    ])
  );
  db.collectionMocks.characters.find.mockReturnValue(cursorWith([]));
  db.collectionMocks.npps.find.mockReturnValue(cursorWith([]));
  db.collectionMocks.politicalParties.find.mockReturnValue(cursorWith([]));
  db.collectionMocks.federalBudget.find.mockReturnValue(
    cursorWith([{ countryId: "US", currencyCode: "USD", treasuryBalance: -1_000_000_000 }])
  );
  db.collectionMocks.indexFunds.find.mockReturnValue(cursorWith([]));
  db.collectionMocks.organizationFunds.find.mockReturnValue(cursorWith([]));
  db.collectionMocks.bonds.find.mockReturnValue(cursorWith([]));
  db.collectionMocks.states.find.mockReturnValue(
    cursorWith([{ _id: "CA", countryId: "US", population: 158_000_000 }])
  );
  db.collectionMocks.macroMetrics.find.mockReturnValue(
    cursorWith([{ _id: "CA", economic: { medianIncome: { value: 3_900 } } }])
  );
  db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].findOne.mockResolvedValue(null);
});

describe("snapshotMoneySupply", () => {
  it("counts 2027 euro-member money in EUR rather than legacy currency snapshots", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ preset: "2027-default" });
    db.collectionMocks.centralBanks.find.mockReturnValue(
      cursorWith([
        {
          _id: "DE",
          countryId: "DE",
          externalBroadMoney: 100,
          netMoneyCreatedLifetime: 0,
        },
      ])
    );
    db.collectionMocks.characters.find.mockReturnValue(
      cursorWith([{ countryId: "FR", funds: 10 }])
    );
    db.collectionMocks.npps.find.mockReturnValue(cursorWith([{ countryId: "IT", funds: 20 }]));
    db.collectionMocks.politicalParties.find.mockReturnValue(
      cursorWith([{ countryId: "ES", treasury: 30 }])
    );
    db.collectionMocks.federalBudget.find.mockReturnValue(cursorWith([]));
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));

    await snapshotMoneySupply(db as unknown as Db, 12);
    const writes = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls;
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]).toMatchObject({
      currencyCode: "EUR",
      campaignLiquid: 10,
      nppLiquid: 20,
      partyLiquid: 30,
    });
  });

  it("counts savings held at a private bank once, alongside its separate NPC deposits", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      moneySupplyEnabled: true,
      treasuryCashLedgerEnabled: true,
    });
    db.collectionMocks.characters.find.mockReturnValue(
      cursorWith([{ countryId: "US", currencyBalances: { savings: { USD: 700 } } }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([
        {
          countryId: "US",
          liquidCapital: 0,
          bankCharter: {
            status: "active",
            currency: "USD",
            cashReserves: 700,
            totalDeposits: 1000,
            npcDeposits: 300,
            playerDeposits: 700,
          },
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));
    await snapshotMoneySupply(db as unknown as Db, 12);
    const doc = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];
    expect(doc.householdSavings).toBe(700);
    expect(doc.bankDeposits).toBe(300);
    expect(doc.bankVaultCash).toBe(700);
    expect(doc.m2 - doc.externalBroadMoney).toBe(1000);
  });

  it("writes an M2 that rises when corporate liquid capital rises", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([{ countryId: "US", liquidCurrencyCode: "USD", liquidCapital: 10_000_000_000 }])
    );

    await snapshotMoneySupply(db as unknown as Db, 12);
    const first = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];
    expect(first.corporateLiquid).toBe(10_000_000_000);
    expect(first.governmentLiquid).toBe(0); // indebted treasury is not money
    expect(first.estimatedHouseholdLiquid).toBeGreaterThan(0);
    expect(first.householdLiquid).toBe(0);
    expect(first.m2).toBeGreaterThan(first.externalBroadMoney);

    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([{ countryId: "US", liquidCurrencyCode: "USD", liquidCapital: 25_000_000_000 }])
    );
    db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mockClear();
    db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].findOne.mockResolvedValue({
      m2: first.m2,
      turn: 0,
    });

    await snapshotMoneySupply(db as unknown as Db, 12);
    const second =
      db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];
    expect(second.m2).toBe(first.m2 + 15_000_000_000);
    expect(second.annualizedM2GrowthPct).toBeGreaterThan(0);
  });

  it("counts only funded Treasury cash when the cash ledger is enabled", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      moneySupplyEnabled: true,
      treasuryCashLedgerEnabled: true,
    });
    db.collectionMocks.federalBudget.find.mockReturnValue(
      cursorWith([
        {
          countryId: "US",
          currencyCode: "USD",
          treasuryBalance: 9_000,
          treasuryCashLocal: 300,
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));

    await snapshotMoneySupply(db as unknown as Db, 12);

    const snapshot =
      db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0]?.[1];
    expect(snapshot.governmentLiquid).toBe(300);
    const options = db.collectionMocks.federalBudget.find.mock.calls[0]?.[1] as {
      projection: Record<string, unknown>;
    };
    expect(options.projection).toHaveProperty("treasuryCashLocal", 1);
    expect(options.projection).not.toHaveProperty("treasuryBalance");
  });

  it("keeps retained central-bank FX cash visible outside observed M2", async () => {
    db.collectionMocks.centralBanks.find.mockReturnValue(
      cursorWith([
        {
          _id: "US",
          countryId: "US",
          externalBroadMoney: 100,
          forexRevenue: 25,
          spreadFeeReserveBalances: { GBP: 50 },
        },
        { _id: "UK", countryId: "UK", externalBroadMoney: 200 },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));
    db.collectionMocks.federalBudget.find.mockReturnValue(cursorWith([]));

    await snapshotMoneySupply(db as unknown as Db, 12);

    const snapshots = db.collectionMocks[
      MONEY_SUPPLY_SNAPSHOTS_COLLECTION
    ].replaceOne.mock.calls.map((call) => call[1]);
    const usd = snapshots.find((snapshot) => snapshot.currencyCode === "USD");
    const gbp = snapshots.find((snapshot) => snapshot.currencyCode === "GBP");
    expect(usd).toMatchObject({
      centralBankForexRevenue: 25,
      m2: 100,
    });
    expect(gbp).toMatchObject({
      centralBankSpreadReserves: 50,
      m2: 200,
    });
  });

  it("counts charter vault and durable bank cash escrows once, excluding noncash bank assets", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      moneySupplyEnabled: true,
      treasuryCashLedgerEnabled: true,
    });
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([
        {
          countryId: "US",
          liquidCurrencyCode: "USD",
          liquidCapital: 100,
          bankCharter: {
            status: "failed",
            currency: "USD",
            cashReserves: 200,
            totalLoans: 900,
            postedCapital: 800,
            sovereignTreasuryMarkValue: 700,
          },
          bankTreasuryEscrows: {
            oldCharterSale: { currencyCode: "USD", amountLocal: 30 },
          },
          bankSovereignEscrows: {
            unpaidCoupon: { currencyCode: "USD", amountLocal: 40 },
          },
          bankPropForexFee: { currencyCode: "USD", amountLocal: 50 },
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));

    await snapshotMoneySupply(db as unknown as Db, 12);

    const snapshot =
      db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];
    expect(snapshot.corporateLiquid).toBe(100);
    expect(snapshot.bankVaultCash).toBe(320);
    const options = db.collectionMocks.corporations.find.mock.calls[0]?.[1] as {
      projection: Record<string, unknown>;
    };
    expect(options.projection).toHaveProperty("bankCharter.cashReserves", 1);
    expect(options.projection).toHaveProperty("bankTreasuryEscrows", 1);
    expect(options.projection).toHaveProperty("bankSovereignEscrows", 1);
    expect(options.projection).toHaveProperty("bankPropForexFee", 1);
  });

  it("counts funded construction cash once in its native currency only when both ledgers are enabled", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      moneySupplyEnabled: true,
      treasuryCashLedgerEnabled: true,
      privateBankingEnabled: true,
      bankConstructionFinanceEnabled: true,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ preset: "2027-default" });
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([{ countryId: "US", liquidCurrencyCode: "USD", liquidCapital: 100 }])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursorWith([
        { constructionFinancing: { currency: "EUR", escrowLocal: 25, collateralCostLocal: 500 } },
        { constructionFinancing: { currency: "USD", escrowLocal: 40, status: "building" } },
        { constructionFinancing: { currency: "EUR", escrowLocal: 0, status: "cancelled" } },
      ])
    );
    db.collectionMocks.federalBudget.find.mockReturnValue(
      cursorWith([
        { countryId: "US", currencyCode: "USD", treasuryCashLocal: 0 },
        { countryId: "FR", currencyCode: "EUR", treasuryCashLocal: 0 },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));

    await snapshotMoneySupply(db as unknown as Db, 12);

    const snapshots = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls;
    const usd = snapshots.find((call) => call[1].currencyCode === "USD")?.[1];
    const eur = snapshots.find((call) => call[1].currencyCode === "EUR")?.[1];
    expect(usd?.corporateLiquid).toBe(140);
    expect(eur?.corporateLiquid).toBe(25);
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursorWith([]));
    db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mockClear();
    await snapshotMoneySupply(db as unknown as Db, 13);
    const withoutEscrow =
      db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls;
    expect(usd!.m2 - withoutEscrow.find((call) => call[1].currencyCode === "USD")![1].m2).toBe(40);
    expect(eur!.m2 - withoutEscrow.find((call) => call[1].currencyCode === "EUR")![1].m2).toBe(25);
    const options = db.collectionMocks.corporateSectors.find.mock.calls[0]?.[1] as {
      projection: Record<string, unknown>;
    };
    expect(options.projection).toEqual({
      "constructionFinancing.currency": 1,
      "constructionFinancing.escrowLocal": 1,
    });
  });

  it("does not read construction escrow when funded cash is off", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      moneySupplyEnabled: true,
      privateBankingEnabled: true,
      bankConstructionFinanceEnabled: true,
    });
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));

    await snapshotMoneySupply(db as unknown as Db, 12);

    expect(db.collectionMocks.corporateSectors.find).not.toHaveBeenCalled();
  });

  it("conserves observed cash when a funded coupon moves from Treasury cash to bank vault", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      moneySupplyEnabled: true,
      treasuryCashLedgerEnabled: true,
    });
    db.collectionMocks.federalBudget.find.mockReturnValue(
      cursorWith([{ countryId: "US", currencyCode: "USD", treasuryCashLocal: 400 }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([
        {
          countryId: "US",
          liquidCurrencyCode: "USD",
          liquidCapital: 0,
          bankCharter: { status: "active", currency: "USD", cashReserves: 200 },
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));
    await snapshotMoneySupply(db as unknown as Db, 12);
    const before =
      db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];

    db.collectionMocks.federalBudget.find.mockReturnValue(
      cursorWith([{ countryId: "US", currencyCode: "USD", treasuryCashLocal: 350 }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([
        {
          countryId: "US",
          liquidCurrencyCode: "USD",
          liquidCapital: 0,
          bankCharter: { status: "active", currency: "USD", cashReserves: 250 },
        },
      ])
    );
    db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mockClear();
    await snapshotMoneySupply(db as unknown as Db, 13);
    const after = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];

    expect(after.governmentLiquid + after.bankVaultCash).toBe(
      before.governmentLiquid + before.bankVaultCash
    );
    expect(after.m2).toBe(before.m2 - 50);
  });

  it("does not double-count bank cash backing deposits captured from external money", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      moneySupplyEnabled: true,
      treasuryCashLedgerEnabled: true,
    });
    db.collectionMocks.centralBanks.find.mockReturnValue(
      cursorWith([{ _id: "US", countryId: "US", externalBroadMoney: 100 }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([
        {
          countryId: "US",
          bankCharter: { status: "active", currency: "USD", cashReserves: 0, npcDeposits: 0 },
        },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(cursorWith([]));
    await snapshotMoneySupply(db as unknown as Db, 12);
    const before =
      db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];

    db.collectionMocks.centralBanks.find.mockReturnValue(
      cursorWith([{ _id: "US", countryId: "US", externalBroadMoney: 0 }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([
        {
          countryId: "US",
          bankCharter: { status: "active", currency: "USD", cashReserves: 100, npcDeposits: 100 },
        },
      ])
    );
    db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mockClear();
    await snapshotMoneySupply(db as unknown as Db, 13);
    const after = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];

    expect(before.m2).toBe(100);
    expect(after.m2).toBe(100);
    expect(after.bankVaultCash).toBe(100);
  });

  it("does not project the new cash stock when the flag is off", async () => {
    await snapshotMoneySupply(db as unknown as Db, 12);
    const options = db.collectionMocks.federalBudget.find.mock.calls[0]?.[1] as {
      projection: Record<string, unknown>;
    };
    expect(options.projection).toHaveProperty("treasuryBalance", 1);
    expect(options.projection).not.toHaveProperty("treasuryCashLocal");
    const corporationOptions = db.collectionMocks.corporations.find.mock.calls[0]?.[1] as {
      projection: Record<string, unknown>;
    };
    expect(corporationOptions.projection).not.toHaveProperty("bankCharter.cashReserves");
    expect(corporationOptions.projection).not.toHaveProperty("bankTreasuryEscrows");
  });

  it("writes a moneySupplySnapshot row for a bank-less command economy (bug: 6 Warsaw-Pact countries had zero rows)", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ preset: "1991-default" });
    // Only US has a centralBanks doc — PL (a command economy excluded from
    // FOREX_ACTIVE_COUNTRIES, like the real PL/HU/CS/RO/BG/YU) has none, but
    // it DOES have a federalBudget row, exactly the sandbox-world shape that
    // exposed the defect: the write loop iterated `banks` alone and silently
    // dropped every bank-less currency's already-computed aggregates.
    db.collectionMocks.federalBudget.find.mockReturnValue(
      cursorWith([
        { countryId: "US", currencyCode: "USD", treasuryBalance: -1_000_000_000 },
        { countryId: "PL", currencyCode: "PLZ", treasuryBalance: 500_000_000 },
      ])
    );
    db.collectionMocks.states.find.mockReturnValue(
      cursorWith([
        { _id: "CA", countryId: "US", population: 158_000_000 },
        { _id: "PL_WAW", countryId: "PL", population: 25_500_000 },
      ])
    );
    db.collectionMocks.macroMetrics.find.mockReturnValue(
      cursorWith([
        { _id: "CA", economic: { medianIncome: { value: 3_900 } } },
        { _id: "PL_WAW", economic: { medianIncome: { value: 800 } } },
      ])
    );
    db.collectionMocks.corporations.find.mockReturnValue(cursorWith([]));

    const written = await snapshotMoneySupply(db as unknown as Db, 12);

    const rows = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls.map(
      (call) => call[1]
    );
    const plRow = rows.find((r) => r.currencyCode === "PLZ");
    expect(plRow).toBeDefined();
    expect(plRow.countryId).toBe("PL");
    // Bank-less: no CB operations ledger behind this currency.
    expect(plRow.netMoneyCreatedLifetime).toBe(0);
    // The point of the fix — PL's household money (derived from its own
    // population/income, independent of any central bank) actually landed.
    expect(plRow.estimatedHouseholdLiquid).toBeGreaterThan(0);
    expect(plRow.householdLiquid).toBe(0);
    expect(plRow.m2).toBe(500_000_000);
    expect(rows.length).toBe(2);
    expect(written).toBe(2);
  });

  it("leaves annualizedM2GrowthPct null when the lookback window is shorter than a quarter", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([{ countryId: "US", liquidCurrencyCode: "USD", liquidCapital: 10_000_000_000 }])
    );
    // Prior at turn 0 with only 3 turns elapsed — the CNY/NGN preflight failure mode.
    db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].findOne.mockResolvedValue({
      m2: 58_855_462_500,
      turn: 0,
    });

    await snapshotMoneySupply(db as unknown as Db, 3);
    const doc = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];
    expect(doc.annualizedM2GrowthPct).toBeNull();
  });
});
