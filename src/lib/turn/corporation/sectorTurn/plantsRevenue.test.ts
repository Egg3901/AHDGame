import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { resolvePlantsRevenue, type PlantsRevenueInput } from "./plantsRevenue";
import { CAPACITY_BINDING_THRESHOLD } from "@/lib/extraction/capacityHaircut";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

const CURRENT_TURN = 1000;
const GOVERNOR_RAMP_TURNS = 240;
const GOVERNOR_CAP = 0.15;
/** Daily nameplate; the hourly baseline is this / 24 with every leg at 1. */
const PRE_FLIP_REVENUE = 240_000;
const BASELINE_HOURLY = PRE_FLIP_REVENUE / TURNS_PER_DAY;

function input(over: Partial<PlantsRevenueInput> = {}): PlantsRevenueInput {
  const sectorId = new ObjectId();
  const corpId = new ObjectId();
  return {
    sector: {
      _id: sectorId,
      sectorType: "manufacturing",
      countryId: "US",
      stateId: "US-CA",
      soldUnits: undefined,
      producedUnits: undefined,
      capacityUtilization: undefined,
      militaryDivertedFraction: 0,
      militaryDivertedTurn: undefined,
    } as PlantsRevenueInput["sector"],
    corp: { _id: corpId, countryId: "US", bankCharter: undefined } as PlantsRevenueInput["corp"],
    strategySupply: {},
    techEffects: { outputRateMult: {}, priceRealizationBonus: 0 },
    plantsEnabled: true,
    mothballed: false,
    nameplateUnits: 1000,
    activeFraction: 1,
    plantsRampLambda: 1,
    capacityUtil: { utilization: 1, bindingResource: null },
    capacityHaircut: 1,
    capitalFactor: 1,
    capacityHaircutStartTurn: undefined,
    clearing: undefined,
    clearingEnabled: false,
    clearingFactor: 1,
    clearingStartTurn: undefined,
    priceRealization: 1,
    priceRatioByCommodity: new Map(),
    embargoLegacyMothball: false,
    embargoTradeExposureActive: false,
    exportIntensityByCountry: new Map(),
    preFlipNameplateRevenue: PRE_FLIP_REVENUE,
    plantsNameplateRevenue: PRE_FLIP_REVENUE,
    revenueMultiplier: 1,
    nationalizationTransition: 1,
    throughputFactor: 1,
    labourOutputFactor: 1,
    strategyIsTransitioning: false,
    retoolCapacityRatio: 1,
    priorProductionUnitRatio: 1,
    disasterOutputFactor: 1,
    newPolicyLevel: 0,
    plantsCapacity: 1000,
    plantsMixPrice: 10,
    plantsStartTurn: CURRENT_TURN - GOVERNOR_RAMP_TURNS,
    currentTurn: CURRENT_TURN,
    governorCap: GOVERNOR_CAP,
    governorRampTurns: GOVERNOR_RAMP_TURNS,
    privateBankingEnabled: false,
    marketPlantsEnabled: false,
    contractProductionTargetBySectorId: undefined,
    ...over,
  };
}

describe("resolvePlantsRevenue — governor bounds + P3b legs (#588)", () => {
  // D12: a mothballed sector earns exactly 0, even mid-ramp where the general
  // rule would blend it part-way toward its running baseline.
  it("earns exactly 0 when mothballed", () => {
    const r = resolvePlantsRevenue(input({ mothballed: true, plantsStartTurn: CURRENT_TURN }));
    expect(r.marketHourlyRevenue).toBe(0);
    expect(r.hourlyRevenue).toBe(0);
  });

  it("returns the counterfactual baseline untouched when plants are off", () => {
    const r = resolvePlantsRevenue(input({ plantsEnabled: false }));
    expect(r.marketHourlyRevenue).toBe(BASELINE_HOURLY);
    expect(r.hourlyRevenue).toBe(BASELINE_HOURLY);
  });

  // Launch-safety governor: λ = 0 on the flip turn returns the baseline
  // exactly, so a sector arriving with headroom does not jump on day one.
  it("returns the baseline exactly on the flip turn", () => {
    const r = resolvePlantsRevenue(input({ plantsStartTurn: CURRENT_TURN }));
    expect(r.marketHourlyRevenue).toBe(r.baselineHourlyRevenue);
    expect(r.baselineHourlyRevenue).toBe(BASELINE_HOURLY);
    // And the derived leg genuinely differs, so the clamp is doing work.
    expect(r.plantsDerivedHourlyRevenue).not.toBe(BASELINE_HOURLY);
  });

  // C5: the amount variant takes zero literally — a halted sector lands on 0
  // at full ramp, not on its full baseline.
  it("passes a zero baseline through to the derived value, not the reverse", () => {
    const r = resolvePlantsRevenue(input({ preFlipNameplateRevenue: 0 }));
    expect(r.baselineHourlyRevenue).toBe(0);
    expect(r.producedUnits).toBeGreaterThan(0);
    expect(r.marketHourlyRevenue).toBe(r.plantsDerivedHourlyRevenue);
    expect(r.marketHourlyRevenue).toBeGreaterThan(0);
  });

  // The governor binds the BLENDED deviation to ±cap at mid-ramp
  // (λ · cap/(1−λ) = cap at λ = 0.5) and releases it entirely at full ramp,
  // where the physical result stands on its own.
  it("clamps derived revenue to the governor band mid-ramp, releases at full ramp", () => {
    const over = {
      // Tiny baseline, large derived: without the clamp the sector would
      // book ~40x its counterfactual on the same turn.
      preFlipNameplateRevenue: 24_000,
      plantsCapacity: 10_000,
      plantsMixPrice: 100,
    } as const;
    const baseline = 24_000 / TURNS_PER_DAY;
    const midRamp = resolvePlantsRevenue(
      input({ ...over, plantsStartTurn: CURRENT_TURN - GOVERNOR_RAMP_TURNS / 2 })
    );
    expect(midRamp.baselineHourlyRevenue).toBeCloseTo(baseline, 8);
    expect(midRamp.plantsDerivedHourlyRevenue).toBeGreaterThan(baseline * (1 + GOVERNOR_CAP));
    expect(midRamp.marketHourlyRevenue).toBeLessThanOrEqual(
      baseline * (1 + GOVERNOR_CAP) * 1.000001
    );
    expect(midRamp.marketHourlyRevenue).toBeGreaterThan(baseline);

    const fullRamp = resolvePlantsRevenue(input(over));
    expect(fullRamp.marketHourlyRevenue).toBe(fullRamp.plantsDerivedHourlyRevenue);
  });

  it("emits a capacity-binding event on the newly-bound edge only", () => {
    const bound = resolvePlantsRevenue(
      input({
        sector: {
          ...input().sector,
          sectorType: "extraction",
          capacityUtilization: undefined,
        } as PlantsRevenueInput["sector"],
        capacityUtil: {
          utilization: CAPACITY_BINDING_THRESHOLD - 0.01,
          bindingResource: "oil",
        },
      })
    );
    expect(bound.capacityBindingEvent).not.toBeNull();
    expect(bound.capacityBindingEvent?.utilization).toBeCloseTo(
      CAPACITY_BINDING_THRESHOLD - 0.01,
      10
    );

    // Already bound last turn: no repeat event.
    const stillBound = resolvePlantsRevenue(
      input({
        sector: {
          ...input().sector,
          sectorType: "extraction",
          capacityUtilization: CAPACITY_BINDING_THRESHOLD - 0.05,
        } as PlantsRevenueInput["sector"],
        capacityUtil: {
          utilization: CAPACITY_BINDING_THRESHOLD - 0.01,
          bindingResource: "oil",
        },
      })
    );
    expect(stillBound.capacityBindingEvent).toBeNull();

    // Non-extraction sectors never emit, even when utilization is low.
    const nonExtraction = resolvePlantsRevenue(
      input({
        capacityUtil: {
          utilization: CAPACITY_BINDING_THRESHOLD - 0.01,
          bindingResource: "oil",
        },
      })
    );
    expect(nonExtraction.capacityBindingEvent).toBeNull();
  });

  // Flip identity under a mid-strategy transition: on the flip turn the
  // governor returns the anchor verbatim, so the anchor must be the
  // capital-mode counterfactual even while transitioning. Anchoring on the
  // transitioning nameplate booked headroom plus the blend as revenue
  // (measured +12% on a manufacturing standard to premium flip).
  it("anchors the flip-turn baseline on the pre-flip nameplate while transitioning", () => {
    const r = resolvePlantsRevenue(
      input({
        strategyIsTransitioning: true,
        retoolCapacityRatio: 1.0211,
        plantsNameplateRevenue: PRE_FLIP_REVENUE * 1.1227,
        plantsRampLambda: 0,
        plantsStartTurn: CURRENT_TURN,
      })
    );
    expect(r.baselineHourlyRevenue).toBe(BASELINE_HOURLY);
    expect(r.marketHourlyRevenue).toBe(BASELINE_HOURLY);
  });

  // Past the flip the transitioning nameplate is the anchor again, so the
  // governor fades realized revenue toward the re-aimed plant, not the old mix.
  it("anchors post-flip transitioning turns on the transitioning nameplate", () => {
    const nameplate = PRE_FLIP_REVENUE * 1.1227;
    const r = resolvePlantsRevenue(
      input({
        strategyIsTransitioning: true,
        retoolCapacityRatio: 1.0211,
        plantsNameplateRevenue: nameplate,
        plantsRampLambda: 0.5,
        plantsStartTurn: CURRENT_TURN - GOVERNOR_RAMP_TURNS / 2,
      })
    );
    expect(r.baselineHourlyRevenue).toBeCloseTo(nameplate / TURNS_PER_DAY, 8);
  });

  it("applies the arsenal diversion after the governor, not inside it", () => {
    const diverted = resolvePlantsRevenue(
      input({
        sector: {
          ...input().sector,
          militaryDivertedFraction: 0.5,
          militaryDivertedTurn: CURRENT_TURN,
        } as PlantsRevenueInput["sector"],
      })
    );
    const clean = resolvePlantsRevenue(input());
    expect(diverted.militaryDivertedFraction).toBe(0.5);
    expect(diverted.hourlyRevenue).toBeCloseTo(clean.hourlyRevenue / 2, 10);
    expect(diverted.marketHourlyRevenue).toBeCloseTo(clean.marketHourlyRevenue, 10);
  });
});
