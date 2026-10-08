import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { retoolRescaleFields } from "@/lib/corporations/retoolRescale";
import { retoolOperatingCapacityRatio } from "@/lib/corporations/retooling/rules";
import { computeMarketTiers, type MarketTiersInput } from "./marketTiers";

const STANDARD_STOCK = 113;

function tiersFor(sector: Partial<CorporateSector>, currentTurn: number) {
  const rates = getEffectiveStrategyRates(
    "manufacturing",
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    currentTurn
  );
  const input: MarketTiersInput = {
    sector: {
      _id: new ObjectId(),
      sectorType: "manufacturing",
      ...sector,
    } as MarketTiersInput["sector"],
    market: buildMarketContext("plants"),
    priceRatioByCommodity: new Map(),
    stateInputAvailabilityByState: new Map(),
    strategySupply: rates.supply,
    strategyDemand: rates.demand,
    wideCommodityBalances: new Map(),
    stateId: "CA",
    currentTurn,
    preFlipNameplateRevenue: STANDARD_STOCK * 1000,
    perTurnGrowthRate: 0,
    eraUnitScale: 1,
  };
  return computeMarketTiers(input);
}

describe("computeMarketTiers capital factor mid-retool (ticket 1424)", () => {
  it("measures owned stock on the blended recipe basis, not destination units", () => {
    const rescaled = retoolRescaleFields({
      sectorType: "manufacturing",
      fromStrategyId: "standard",
      toStrategyId: "vehicle_assembly",
      plantsEnabled: true,
      capitalStock: STANDARD_STOCK,
    });
    const sector: Partial<CorporateSector> = {
      strategyId: "vehicle_assembly",
      transitionFromStrategyId: "standard",
      transitionStartTurn: 45,
      ...rescaled,
    };
    // Owned stock is destination-basis: ~50x fewer vehicle units than standard.
    expect(rescaled.capitalStock!).toBeLessThan(STANDARD_STOCK / 40);
    const ratio = retoolOperatingCapacityRatio({
      sectorType: "manufacturing",
      strategyId: "vehicle_assembly",
      transitionFromStrategyId: "standard",
      transitionStartTurn: 45,
      retoolRescaleApplied: true,
      currentTurn: 48,
    });
    expect(ratio).toBeGreaterThan(30);

    const tiers = tiersFor(sector, 48);
    // Before the fix: 2.26 destination units / ~85 blended units = 0.026,
    // which collapsed the governor baseline and realized revenue to ~3%.
    expect(tiers.capitalFactor).toBeGreaterThan(0.95);
    // Persisted stock stays on the destination basis.
    expect(tiers.newCapitalStock).toBeCloseTo(rescaled.capitalStock!, 2);
  });

  it("leaves non-retooling sectors unchanged", () => {
    const tiers = tiersFor({ strategyId: "standard", capitalStock: STANDARD_STOCK / 2 }, 48);
    expect(tiers.capitalFactor).toBeCloseTo(0.5, 3);
  });
});
