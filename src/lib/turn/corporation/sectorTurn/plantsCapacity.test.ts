import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { computePlantsCapacity, type PlantsCapacityInput } from "./plantsCapacity";
import { seedCapitalStock, impliedOutputUnits } from "@/lib/market/capital";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { CAPITAL_SEED_HEADROOM, CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import { getEffectiveStrategyRates, getStrategy } from "@/lib/constants/sectorStrategies";
import { revenuePerCapacityUnitForStrategy } from "@/lib/constants/capacityEconomy";

const CURRENT_TURN = 1000;
const GOVERNOR_RAMP_TURNS = 240;
const PRE_FLIP_REVENUE = 240_000;
const SUPPLY = { steel: 1 } as const;

function input(over: Partial<PlantsCapacityInput> = {}): PlantsCapacityInput {
  return {
    sector: {
      capitalStock: 0,
      mothballed: false,
      activeCapacityPercent: undefined,
      capacityBookAnchor: undefined,
      plantsStartTurn: undefined,
      transitionFromStrategyId: null,
      strategyId: "standard",
      sectorType: "manufacturing",
      transitionStartTurn: undefined,
      retoolRescaleApplied: undefined,
      operatingCapacityTurn: undefined,
      autoStrategyAdoptedAtTurn: undefined,
      otherOpexPerUnitAnchor: undefined,
    } as PlantsCapacityInput["sector"],
    corp: { ceoType: "character" },
    plantsEnabled: true,
    isFlipTurn: true,
    preFlipNameplateRevenue: PRE_FLIP_REVENUE,
    strategySupply: { ...SUPPLY },
    eraUnitScale: 1,
    landedBuildUnits: 0,
    landedBuildCostAnchor: 0,
    capacityUnitPriceAnchor: 100,
    newRevenue: PRE_FLIP_REVENUE,
    currentTurn: CURRENT_TURN,
    governorRampTurns: GOVERNOR_RAMP_TURNS,
    embargoLegacyMothball: false,
    ...over,
  };
}

describe("computePlantsCapacity — plants capacity advance + P5 basis (#588)", () => {
  it("is inert when plants are off", () => {
    const r = computePlantsCapacity(input({ plantsEnabled: false, isFlipTurn: false }));
    expect(r.mothballed).toBe(false);
    expect(r.activeFraction).toBe(1);
    expect(r.plantsCapacity).toBe(0);
    expect(r.plantsNameplateRevenue).toBe(PRE_FLIP_REVENUE);
    expect(r.plantsRampLambda).toBe(1);
  });

  // Flip identity: the first plants turn stamps the ramp anchor and the ramp
  // is exactly 0 there, so every leg that fades on it is a no-op on flip day.
  it("stamps the ramp anchor on the flip turn with lambda 0", () => {
    const r = computePlantsCapacity(input());
    expect(r.plantsStartTurn).toBe(CURRENT_TURN);
    expect(r.plantsRampLambda).toBe(0);
  });

  it("ramps lambda linearly to 1 over the governor window", () => {
    const half = computePlantsCapacity(
      input({
        isFlipTurn: false,
        sector: {
          ...input().sector,
          plantsStartTurn: CURRENT_TURN - GOVERNOR_RAMP_TURNS / 2,
        } as PlantsCapacityInput["sector"],
      })
    );
    expect(half.plantsRampLambda).toBeCloseTo(0.5, 10);
    const full = computePlantsCapacity(
      input({
        isFlipTurn: false,
        sector: {
          ...input().sector,
          plantsStartTurn: CURRENT_TURN - GOVERNOR_RAMP_TURNS,
        } as PlantsCapacityInput["sector"],
      })
    );
    expect(full.plantsRampLambda).toBe(1);
  });

  // Flip migration: capacity := max(existing capitalStock,
  // impliedOutputUnits(nameplate)) — a sector that never ran under capital
  // starts at exactly the units its revenue base implied, times headroom.
  it("seeds an empty sector from the revenue-implied units with headroom", () => {
    const r = computePlantsCapacity(input());
    const expectedSeed = seedCapitalStock(
      PRE_FLIP_REVENUE,
      { ...SUPPLY },
      COMMODITY_BASE_PRICES,
      1
    );
    expect(r.plantsBaseStock).toBeCloseTo(expectedSeed, 8);
    expect(expectedSeed).toBeGreaterThan(0);
    // The seed carries the headroom factor over bare implied units.
    const implied = impliedOutputUnits(PRE_FLIP_REVENUE, { ...SUPPLY }, COMMODITY_BASE_PRICES, 1);
    expect(r.plantsBaseStock).toBeCloseTo(implied * CAPITAL_SEED_HEADROOM, 8);
  });

  it("keeps stored capital when it exceeds the seed (no silent gift)", () => {
    const stored = 1e9;
    const r = computePlantsCapacity(
      input({
        sector: {
          ...input().sector,
          capitalStock: stored,
        } as PlantsCapacityInput["sector"],
      })
    );
    expect(r.plantsBaseStock).toBe(stored);
  });

  it("only migrates once: a later turn starts from stored stock", () => {
    const seed = seedCapitalStock(PRE_FLIP_REVENUE, { ...SUPPLY }, COMMODITY_BASE_PRICES, 1);
    const r = computePlantsCapacity(
      input({
        isFlipTurn: false,
        sector: {
          ...input().sector,
          capitalStock: seed / 2,
          plantsStartTurn: CURRENT_TURN - 10,
        } as PlantsCapacityInput["sector"],
      })
    );
    expect(r.plantsBaseStock).toBeCloseTo(seed / 2, 8);
  });

  it("depreciates (never grows) the advance when the growth slider is 0", () => {
    const stored = 500_000;
    const r = computePlantsCapacity(
      input({
        isFlipTurn: false,
        sector: {
          ...input().sector,
          capitalStock: stored,
          plantsStartTurn: CURRENT_TURN - 10,
        } as PlantsCapacityInput["sector"],
      })
    );
    expect(r.plantsOwnedCapacity).toBeLessThanOrEqual(r.plantsPrevStock);
    expect(r.plantsOwnedCapacity).toBeGreaterThan(0);
  });

  it("marks a mothballed sector cold", () => {
    const r = computePlantsCapacity(
      input({
        sector: {
          ...input().sector,
          mothballed: true,
        } as PlantsCapacityInput["sector"],
      })
    );
    expect(r.mothballed).toBe(true);
  });

  it("keeps the per-unit paid basis flat under depreciation", () => {
    const stored = 500_000;
    const book = 50_000_000;
    const base = input({
      isFlipTurn: false,
      sector: {
        ...input().sector,
        capitalStock: stored,
        capacityBookAnchor: book,
        plantsStartTurn: CURRENT_TURN - 10,
      } as PlantsCapacityInput["sector"],
    });
    const r = computePlantsCapacity(base);
    const factor = r.plantsOwnedCapacity / r.plantsPrevStock;
    expect(r.capacityBookAnchor).toBeCloseTo(book * factor, 6);
  });

  it("uses the sector id only through typed picks (smoke)", () => {
    void new ObjectId();
    expect(() => computePlantsCapacity(input())).not.toThrow();
  });

  // Flip-turn retool basis: owned stock converts to destination units at the
  // retool boundary, so the flip seed must be destination-basis too while
  // the blend ratio applies. Seeding from the blended recipe mixed bases in
  // the max() and minted ~2% on a manufacturing standard to premium flip
  // (far more on extreme pairs).
  it("seeds a flip-turn transition in destination units", () => {
    const from = "standard";
    const to = "premium";
    const startTurn = CURRENT_TURN - 5;
    const effective = getEffectiveStrategyRates("manufacturing", to, from, startTurn, CURRENT_TURN);
    expect(effective.isTransitioning).toBe(true);
    const sourceSupply = getStrategy("manufacturing", from).supply;
    const sourceSeed = seedCapitalStock(
      PRE_FLIP_REVENUE,
      { ...sourceSupply },
      COMMODITY_BASE_PRICES,
      1
    );
    const r = computePlantsCapacity(
      input({
        sector: {
          ...input().sector,
          capitalStock: sourceSeed,
          strategyId: to,
          transitionFromStrategyId: from,
          transitionStartTurn: startTurn,
        } as PlantsCapacityInput["sector"],
        strategySupply: { ...effective.supply },
        preFlipNameplateRevenue: PRE_FLIP_REVENUE,
      })
    );
    expect(r.retoolCapacityRatio).not.toBe(1);
    // The invariant, modulo one turn of depreciation: converted stock at
    // destination productivity. Never the blended seed times the blend.
    const sourceValue = sourceSeed * revenuePerCapacityUnitForStrategy("manufacturing", from, 1);
    expect(r.plantsNameplateRevenue / sourceValue).toBeCloseTo(
      1 - CAPITAL_DEPRECIATION_PER_TURN,
      3
    );
  });
});
