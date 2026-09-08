import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateCountryInflation } from "./inflation";

let db: MockDb;
const budget = {
  countryId: "US",
  gdp: 1_000_000,
  surplus: 0,
  economicFactors: { wageGrowth: 3, inflationRate: 2 },
} as FederalBudget;

beforeEach(() => {
  db = createMockDb();
  db.collection("gameConfig");
  db.collection("gameState");
  db.collection("macroMetrics");
  db.collection("centralBanks");
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({ moneySupplyEnabled: true });
  db.collectionMocks.gameState.findOne.mockResolvedValue({ currentYear: 2019 });
  db.collectionMocks.macroMetrics.findOne.mockResolvedValue({
    economic: { gdpGrowth: { value: 4 }, unemploymentRate: { value: 5 } },
  });
  db.collectionMocks.centralBanks.findOne.mockResolvedValue({ primeRate: 3 });
});

async function inflation(moneyGrowth?: number) {
  return calculateCountryInflation(db as unknown as Db, "US", budget, 0, 0, 0, 0, moneyGrowth);
}

describe("money supply input to country inflation", () => {
  it("treats missing observations as no monetary signal, including annual budget callers", async () => {
    expect(await inflation()).toBe(await inflation(4));
    expect(await inflation(0)).toBeLessThan(await inflation(4));
  });

  it("stops monetary transmission when its feature is disabled despite old snapshots", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ moneySupplyEnabled: false });
    expect(await inflation(100)).toBe(await inflation(4));
    expect(await inflation(-100)).toBe(await inflation(4));
  });
});
