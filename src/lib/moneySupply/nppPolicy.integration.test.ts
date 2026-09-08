import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("./operations", () => ({
  MONETARY_OPERATION_COOLDOWN_TURNS: 6,
  executeMonetaryOperation: vi.fn(),
}));
import { executeMonetaryOperation } from "./operations";
import { processNppMonetaryOperations } from "./nppPolicy";

describe("monetary policy after accounting transition", () => {
  it.each([
    [undefined, 500, false],
    [2, null, false],
    [2, 500, true],
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
