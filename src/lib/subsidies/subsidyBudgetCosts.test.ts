import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { MarketSystemMode } from "@/lib/market/modes";

let marketMode: MarketSystemMode = "capital";
vi.mock("@/lib/market/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market/featureFlag")>();
  return { ...actual, getMarketSystemModeForDb: async () => marketMode };
});
vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency/corporationCapital")>();
  return { ...actual, loadFxRatesByCurrency: async () => new Map<string, number>([["USD", 1]]) };
});

const { loadAnnualSubsidyCostMaps, SUBSIDY_COST_MULTIPLIER } =
  await import("@/lib/subsidies/subsidyBudgetCosts");
const { TURNS_PER_YEAR } = await import("@/lib/constants/turnTime");
const { getNationalBudgetId } = await import("@/lib/bonds/sovereign");

const corpId = new ObjectId();

/**
 * Minimal stand-in for the two `find(...).toArray()` reads and the one
 * getActiveSubsidies read this loader makes. MockDb's cursor does not honour a
 * projection argument, and the projection is the whole point of the field this
 * test exercises, so the collections are stubbed directly.
 */
function fakeDb(sector: Record<string, unknown>) {
  const docs: Record<string, unknown[]> = {
    subsidies: [
      {
        _id: new ObjectId(),
        countryId: "US",
        scope: "national",
        scopeType: "economy_wide",
        targetSectorType: null,
        targetStrategyId: null,
        domesticOnly: false,
        active: true,
      },
    ],
    corporations: [{ _id: corpId, headquartersState: "CA", countryId: "US" }],
    corporateSectors: [
      {
        _id: new ObjectId(),
        corporationId: corpId,
        stateId: "CA",
        countryId: "US",
        sectorType: "manufacturing",
        strategyId: "standard",
        ...sector,
      },
    ],
  };
  return {
    collection: (name: string) => ({
      find: () => ({ toArray: async () => docs[name] ?? [] }),
    }),
  };
}

const billed = (maps: { nationalCostByBudgetId: Map<string, number> }) =>
  maps.nationalCostByBudgetId.get(getNationalBudgetId("US")) ?? 0;

describe("loadAnnualSubsidyCostMaps revenue basis (P3.5)", () => {
  beforeEach(() => {
    marketMode = "capital";
  });

  it("bills nameplate revenue below the plants tier, ignoring realizedRevenue", async () => {
    const maps = await loadAnnualSubsidyCostMaps(
      fakeDb({ revenue: 1000, realizedRevenue: 400 }) as any
    );
    expect(billed(maps)).toBeCloseTo(1000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER);
  });

  it("bills realized revenue under plants, closing the nameplate overpay", async () => {
    marketMode = "plants";

    const maps = await loadAnnualSubsidyCostMaps(
      fakeDb({ revenue: 1000, realizedRevenue: 400 }) as any
    );
    expect(billed(maps)).toBeCloseTo(400 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER);
  });

  it("bills the identical figure at the calibration state (full realization)", async () => {
    marketMode = "plants";

    const maps = await loadAnnualSubsidyCostMaps(
      fakeDb({ revenue: 1000, realizedRevenue: 1000 }) as any
    );
    expect(billed(maps)).toBeCloseTo(1000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER);
  });

  it("falls back to nameplate under plants when realizedRevenue is absent", async () => {
    marketMode = "plants";

    const maps = await loadAnnualSubsidyCostMaps(fakeDb({ revenue: 1000 }) as any);
    expect(billed(maps)).toBeCloseTo(1000 * TURNS_PER_YEAR * SUBSIDY_COST_MULTIPLIER);
  });
});
