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

describe("computeMarketTiers throughput input availability", () => {
  function throughputFor(args: {
    demand: MarketTiersInput["strategyDemand"];
    local?: Map<string, Map<string, number>>;
    priority?: Map<string, number>;
    wide?: Map<string, { supply: number; demand: number }>;
    stateBalances?: Map<string, { supply: number; demand: number }>;
  }) {
    const sectorId = new ObjectId();
    const market = buildMarketContext("plants");
    if (args.priority) {
      market.internalInputAvailabilityBySectorId = new Map([
        [sectorId.toString(), args.priority],
      ]) as never;
    }
    const input: MarketTiersInput = {
      sector: {
        _id: sectorId,
        sectorType: "manufacturing",
        strategyId: "standard",
      } as MarketTiersInput["sector"],
      market,
      priceRatioByCommodity: new Map(),
      stateInputAvailabilityByState: (args.local ?? new Map()) as never,
      strategySupply: {},
      strategyDemand: args.demand,
      wideCommodityBalances: (args.wide ?? new Map()) as never,
      ...(args.stateBalances ? { stateBalances: args.stateBalances as never } : {}),
      stateId: "CA",
      currentTurn: 100,
      preFlipNameplateRevenue: 1000,
      perTurnGrowthRate: 0,
      eraUnitScale: 1,
    };
    return computeMarketTiers(input).throughputRaw;
  }

  it("a: internal supply cannot lower availability below the state-local figure", () => {
    const t = throughputFor({
      demand: { plastics: 1 },
      local: new Map([["CA", new Map([["plastics", 1]])]]),
      priority: new Map([["plastics", 0.5]]),
      wide: new Map([["plastics", { supply: 50, demand: 100 }]]),
    });
    expect(t.throughput).toBe(1);
    expect(t.bindingInput).not.toBe("plastics");
    expect(t.bindingInput).toBeNull();
  });

  it("b: internal supply can raise availability above the state-local figure", () => {
    const t = throughputFor({
      demand: { plastics: 1 },
      local: new Map([["CA", new Map([["plastics", 0.6]])]]),
      priority: new Map([["plastics", 0.9]]),
      wide: new Map([["plastics", { supply: 50, demand: 100 }]]),
    });
    expect(t.throughput).toBeCloseTo(0.9, 10);
    expect(t.bindingInput).toBe("plastics");
  });

  it("c: a priority entry with no local entry is used unchanged", () => {
    const t = throughputFor({
      demand: { plastics: 1 },
      priority: new Map([["plastics", 0.7]]),
      wide: new Map([["plastics", { supply: 100, demand: 100 }]]),
    });
    expect(t.throughput).toBeCloseTo(0.7, 10);
    expect(t.bindingInput).toBe("plastics");
  });

  it("d: state-scoped freight uses the state balance, not the country book in shortage", () => {
    const t = throughputFor({
      demand: { freight: 1 },
      wide: new Map([["freight", { supply: 64681.85, demand: 92567.28 }]]),
      stateBalances: new Map([["freight", { supply: 7597.46, demand: 5562.42 }]]),
    });
    expect(t.throughput).toBe(1);
    expect(t.bindingInput).toBeNull();
  });

  it("e: freight with no state balance falls back to the country book", () => {
    const t = throughputFor({
      demand: { freight: 1 },
      wide: new Map([["freight", { supply: 64681.85, demand: 92567.28 }]]),
    });
    expect(t.throughput).toBeCloseTo(64681.85 / 92567.28, 10);
    expect(t.bindingInput).toBe("freight");
  });

  it("f: a reachable commodity still uses the country book even with a state balance", () => {
    const t = throughputFor({
      demand: { coal: 1 },
      wide: new Map([["coal", { supply: 70, demand: 100 }]]),
      stateBalances: new Map([["coal", { supply: 100, demand: 50 }]]),
    });
    expect(t.throughput).toBeCloseTo(0.7, 10);
    expect(t.bindingInput).toBe("coal");
  });

  it("g: a state-scoped input with an internal-supply residual still reads its state balance", () => {
    const t = throughputFor({
      demand: { construction_services: 1 },
      priority: new Map([["construction_services", 0.5]]),
      wide: new Map([["construction_services", { supply: 50, demand: 100 }]]),
      stateBalances: new Map([["construction_services", { supply: 120, demand: 100 }]]),
    });
    expect(t.throughput).toBe(1);
    expect(t.bindingInput).toBeNull();
  });

  it("h: a higher internal-supply value is kept over a short state balance", () => {
    const t = throughputFor({
      demand: { construction_services: 1 },
      priority: new Map([["construction_services", 0.9]]),
      wide: new Map([["construction_services", { supply: 50, demand: 100 }]]),
      stateBalances: new Map([["construction_services", { supply: 60, demand: 100 }]]),
    });
    expect(t.throughput).toBeCloseTo(0.9, 10);
    expect(t.bindingInput).toBe("construction_services");
  });
});
