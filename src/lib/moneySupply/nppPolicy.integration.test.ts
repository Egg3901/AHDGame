import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("./operations", () => ({
  MONETARY_OPERATION_COOLDOWN_TURNS: 6,
  executeMonetaryOperation: vi.fn(),
}));
import { executeMonetaryOperation } from "./operations";
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
  it.each(["player", "npp"] as const)(
    "uses the %s common chair for all member operations",
    async (chairMode) => {
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
            members: {
              DE: { countryId: "DE", ledgerCurrency: "EUR", ledgerUnitsPerAnchorUnit: 1 },
              UK: { countryId: "UK", ledgerCurrency: "GBP", ledgerUnitsPerAnchorUnit: 0.8 },
            },
          },
        },
      ]);
      db.seed("centralBanks", [
        { _id: "ECB", countryId: "DE", chairMode, reserveBalance: 1000 },
        { _id: "BOE", countryId: "UK", chairMode: "npp", reserveBalance: 1000 },
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
        expect(evaluations[0].inflation).toBe(evaluations[1].inflation);
        expect(evaluations[0].gdpGrowth).toBe(evaluations[1].gdpGrowth);
        expect(evaluations[0].moneyGrowthReliable).toBe(false);
      }
    }
  );
});
