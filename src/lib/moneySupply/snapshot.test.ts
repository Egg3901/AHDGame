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
  it("writes an M2 that rises when corporate liquid capital rises", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorWith([{ countryId: "US", liquidCurrencyCode: "USD", liquidCapital: 10_000_000_000 }])
    );

    await snapshotMoneySupply(db as unknown as Db, 12);
    const first = db.collectionMocks[MONEY_SUPPLY_SNAPSHOTS_COLLECTION].replaceOne.mock.calls[0][1];
    expect(first.corporateLiquid).toBe(10_000_000_000);
    expect(first.governmentLiquid).toBe(0); // indebted treasury is not money
    expect(first.householdLiquid).toBeGreaterThan(0);
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

  it("writes a moneySupplySnapshot row for a bank-less command economy (bug: 6 Warsaw-Pact countries had zero rows)", async () => {
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
    expect(plRow.householdLiquid).toBeGreaterThan(0);
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
