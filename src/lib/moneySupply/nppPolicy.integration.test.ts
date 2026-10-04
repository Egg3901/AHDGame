import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("./operations", () => ({
  MONETARY_OPERATION_COOLDOWN_TURNS: 6,
  executeMonetaryOperation: vi.fn(),
}));
import { executeMonetaryOperation } from "./operations";
import { LiquidityAdvanceRejected } from "./liquidityAdvance";
import { processNppMonetaryOperations } from "./nppPolicy";
import { MONEY_ACCOUNTING_VERSION } from "./rules/calculate";

describe("monetary policy after accounting transition", () => {
  it.each([
    [undefined, 500, false],
    [MONEY_ACCOUNTING_VERSION - 1, 500, false],
    [MONEY_ACCOUNTING_VERSION, null, false],
    [MONEY_ACCOUNTING_VERSION, 500, true],
  ] as const)(
    "only tightens on comparable version %s growth %s",
    async (accountingVersion, annualizedM2GrowthPct, shouldTighten) => {
      vi.mocked(executeMonetaryOperation).mockClear();
      const db = createInMemoryDb();
      db.seed("gameConfig", [{ _id: "default", moneySupplyEnabled: true }]);
      db.seed("gameState", [{ _id: "current", startingYear: 1960 }]);
      db.seed("centralBanks", [
        { _id: "US", countryId: "US", chairMode: "npp", reserveBalance: 1000 },
      ]);
      db.seed("federalBudget", [
        { _id: "federal", gdp: 10000, economicFactors: { inflationRate: 2, gdpGrowth: 2 } },
      ]);
      db.seed("bonds", [
        {
          _id: "bond",
          issuerType: "sovereign",
          countryId: "US",
          matured: false,
          defaulted: false,
          publicFloat: 100,
          centralBankHoldings: 100,
          maturityTurn: 200,
        },
      ]);
      db.seed("moneySupplySnapshots", [
        { _id: "money", currencyCode: "USD", turn: 100, accountingVersion, annualizedM2GrowthPct },
      ]);
      const bonds = db.collection("bonds");
      const findBonds = bonds.find.bind(bonds);
      vi.spyOn(bonds, "find").mockImplementation((filter) => {
        const cursor = findBonds(filter);
        return Object.assign(cursor, { next: async () => (await cursor.toArray())[0] ?? null });
      });
      const result = await processNppMonetaryOperations(db as unknown as Db, 100, 1960);
      expect(result.operationsExecuted).toBe(shouldTighten ? 1 : 0);
      const bank = db.collection("centralBanks").docs[0];
      expect(bank.lastMonetaryPolicyEvaluation).toMatchObject({
        moneyGrowthReliable: shouldTighten,
        annualizedM2GrowthPct: shouldTighten ? 500 : null,
      });
    }
  );
});

describe("common monetary authority", () => {
  it.each([
    ["player", false],
    ["npp", false],
    ["npp", true],
  ] as const)(
    "uses the %s common chair with comparable common money=%s",
    async (chairMode, comparableMoney) => {
      vi.mocked(executeMonetaryOperation).mockClear();
      const db = createInMemoryDb();
      db.seed("gameConfig", [{ _id: "default", moneySupplyEnabled: true }]);
      db.seed("gameState", [
        {
          _id: "current",
          startingYear: 1991,
          preset: "1991-default",
          euroMonetaryUnion: {
            authorityId: "ECB",
            establishedTurn: 400,
            members: {
              DE: {
                countryId: "DE",
                ledgerCurrency: "EUR",
                ledgerUnitsPerAnchorUnit: 1,
                joinedTurn: 400,
              },
              UK: {
                countryId: "UK",
                ledgerCurrency: "GBP",
                ledgerUnitsPerAnchorUnit: 0.8,
                joinedTurn: 400,
              },
            },
          },
        },
      ]);
      db.seed("centralBanks", [
        { _id: "ECB", countryId: "DE", chairMode, reserveBalance: 1000 },
        { _id: "UK", countryId: "UK", chairMode: "npp", reserveBalance: 1000 },
      ]);
      db.seed("federalBudget", [
        { _id: "DE", gdp: 10000, economicFactors: { inflationRate: 0, gdpGrowth: 0 } },
        { _id: "UK", gdp: 10000, economicFactors: { inflationRate: 1, gdpGrowth: 1 } },
      ]);
      db.seed(
        "bonds",
        ["DE", "UK"].map((countryId) => ({
          _id: `bond-${countryId}`,
          issuerType: "sovereign",
          countryId,
          matured: false,
          defaulted: false,
          publicFloat: 100,
          centralBankHoldings: 100,
          maturityTurn: 200,
        }))
      );
      if (comparableMoney) {
        db.seed(
          "moneySupplySnapshots",
          [488, 500].flatMap((turn) =>
            ["EUR", "GBP"].map((currencyCode) => ({
              _id: `${turn}:${currencyCode}`,
              turn,
              currencyCode,
              accountingVersion: MONEY_ACCOUNTING_VERSION,
              m2: (turn === 488 ? 100 : 200) * (currencyCode === "GBP" ? 0.8 : 1),
            }))
          )
        );
      }
      const snapshots = db.collection("moneySupplySnapshots");
      const moneyReads = vi.spyOn(snapshots, "find");
      const bonds = db.collection("bonds");
      const findBonds = bonds.find.bind(bonds);
      vi.spyOn(bonds, "find").mockImplementation((filter) => {
        const cursor = findBonds(filter);
        return Object.assign(cursor, { next: async () => (await cursor.toArray())[0] ?? null });
      });
      await processNppMonetaryOperations(db as unknown as Db, 500, 2001);
      expect(executeMonetaryOperation).toHaveBeenCalledTimes(chairMode === "npp" ? 2 : 0);
      if (chairMode === "npp") {
        expect(executeMonetaryOperation).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ countryId: "UK", actorName: "ECB Monetary Committee" })
        );
        const evaluations = db
          .collection("centralBanks")
          .docs.map((bank) => bank.lastMonetaryPolicyEvaluation);
        expect(evaluations).toEqual([
          expect.objectContaining({
            moneyGrowthReliable: comparableMoney,
            annualizedM2GrowthPct: comparableMoney ? 1500 : null,
          }),
          expect.objectContaining({
            moneyGrowthReliable: comparableMoney,
            annualizedM2GrowthPct: comparableMoney ? 1500 : null,
          }),
        ]);
        expect(moneyReads).toHaveBeenCalledTimes(1);
      }
    }
  );
});

function seedRecessionWorld(banks: Record<string, unknown>[], budgetIds: string[]) {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", moneySupplyEnabled: true }]);
  db.seed("gameState", [{ _id: "current", startingYear: 1953, preset: "1953-default" }]);
  db.seed("centralBanks", banks);
  db.seed(
    "federalBudget",
    budgetIds.map((_id) => ({
      _id,
      gdp: 10000,
      economicFactors: { inflationRate: -1, gdpGrowth: -2 },
    }))
  );
  const bonds = db.collection("bonds");
  const findBonds = bonds.find.bind(bonds);
  vi.spyOn(bonds, "find").mockImplementation((filter) => {
    const cursor = findBonds(filter);
    return Object.assign(cursor, { next: async () => (await cursor.toArray())[0] ?? null });
  });
  return db;
}

describe("bank documents that are not the country's bank", () => {
  it.each([
    [98, 0],
    [90, 1],
  ])(
    "a dormant shared bank never acts for DD (DD last operated at turn %i)",
    async (lastMonetaryOperationTurn, calls) => {
      vi.mocked(executeMonetaryOperation).mockReset();
      const db = seedRecessionWorld(
        [
          { _id: "ECB", countryId: "DD", chairMode: "npp", reserveBalance: 1 },
          {
            _id: "DD",
            countryId: "DD",
            chairMode: "npp",
            reserveBalance: 2,
            lastMonetaryOperationTurn,
          },
        ],
        ["DD"]
      );
      const result = await processNppMonetaryOperations(db as unknown as Db, 100, 1953);
      expect(result.banksProcessed).toBe(1);
      expect(executeMonetaryOperation).toHaveBeenCalledTimes(calls);
      if (calls > 0) {
        expect(executeMonetaryOperation).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            countryId: "DD",
            operationId: "npp-liquidity-DD-100",
            actorName: "DD Monetary Committee",
          })
        );
        const dd = db.collection("centralBanks").docs.find((bank) => bank._id === "DD");
        expect(dd?.lastMonetaryPolicyEvaluation).toMatchObject({ bankReserves: 2 });
      }
      const ecb = db.collection("centralBanks").docs.find((bank) => bank._id === "ECB");
      expect(ecb?.lastMonetaryPolicyEvaluation).toBeUndefined();
    }
  );
});

describe("refused monetary operations", () => {
  it("skip the refused bank and keep evaluating the rest", async () => {
    vi.mocked(executeMonetaryOperation)
      .mockReset()
      .mockRejectedValueOnce(
        new LiquidityAdvanceRejected(
          "Monetary operation is on cooldown or another liquidity command is pending"
        )
      );
    const db = seedRecessionWorld(
      [
        { _id: "US", countryId: "US", chairMode: "npp", reserveBalance: 1 },
        { _id: "JP", countryId: "JP", chairMode: "npp", reserveBalance: 1 },
      ],
      ["federal", "JP"]
    );
    const result = await processNppMonetaryOperations(db as unknown as Db, 100, 1953);
    expect(executeMonetaryOperation).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ banksProcessed: 2, evaluationsRecorded: 2, operationsExecuted: 1 });
  });

  it("still fail the phase on an unexpected error", async () => {
    vi.mocked(executeMonetaryOperation)
      .mockReset()
      .mockRejectedValueOnce(new Error("ledger unavailable"));
    const db = seedRecessionWorld(
      [{ _id: "US", countryId: "US", chairMode: "npp", reserveBalance: 1 }],
      ["federal"]
    );
    await expect(processNppMonetaryOperations(db as unknown as Db, 100, 1953)).rejects.toThrow(
      "ledger unavailable"
    );
  });
});
