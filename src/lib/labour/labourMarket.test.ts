import { describe, expect, it } from "vitest";
import {
  LABOUR_STAFFING_MAX_TURN_MOVE,
  accumulateLabourDemand,
  computeLabourTightness,
  filledWorkers,
  glideStaffingFactor,
  makeLabourDemandByState,
  roundTightness,
  staffingFactorFromTightness,
} from "./labourMarket";

describe("accumulateLabourDemand", () => {
  it("sums every sector's headcount into its own state", () => {
    const demand = makeLabourDemandByState();
    accumulateLabourDemand(demand, "AZ", 1000);
    accumulateLabourDemand(demand, "AZ", 250);
    accumulateLabourDemand(demand, "NY", 40);
    expect(demand.get("AZ")).toBe(1250);
    expect(demand.get("NY")).toBe(40);
  });

  it("floors negative and non-finite headcounts to zero so one corrupt sector cannot fake slack", () => {
    const demand = makeLabourDemandByState();
    accumulateLabourDemand(demand, "AZ", 500);
    accumulateLabourDemand(demand, "AZ", -900);
    accumulateLabourDemand(demand, "AZ", Number.NaN);
    accumulateLabourDemand(demand, "AZ", Number.POSITIVE_INFINITY);
    expect(demand.get("AZ")).toBe(500);
  });

  it("starts empty so a turn that processed no sectors writes nothing", () => {
    expect(makeLabourDemandByState().size).toBe(0);
  });
});

describe("computeLabourTightness", () => {
  it("reads 1.0 when demand exactly matches the labour force", () => {
    expect(computeLabourTightness(314_613, 314_613)).toBe(1);
  });

  it("reads below 1 for a slack market", () => {
    expect(computeLabourTightness(150_000, 300_000)).toBeCloseTo(0.5, 6);
  });

  it("does not clamp an oversubscribed market, because the size of the overrun is the finding", () => {
    // The live Arizona case: one state's corporate sectors wanting roughly 200x
    // the people who live there. A cap would hide exactly what phase 1 measures.
    const tightness = computeLabourTightness(63_200_000, 314_613);
    expect(tightness).toBeGreaterThan(200);
  });

  it("returns undefined when supply is missing, so unknown never reads as infinite", () => {
    expect(computeLabourTightness(1000, undefined)).toBeUndefined();
    expect(computeLabourTightness(1000, null)).toBeUndefined();
  });

  it("returns undefined for a zero or negative labour force rather than dividing", () => {
    expect(computeLabourTightness(1000, 0)).toBeUndefined();
    expect(computeLabourTightness(1000, -5)).toBeUndefined();
  });

  it("returns undefined for non-finite supply or demand", () => {
    expect(computeLabourTightness(1000, Number.NaN)).toBeUndefined();
    expect(computeLabourTightness(1000, Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(computeLabourTightness(Number.NaN, 1000)).toBeUndefined();
    expect(computeLabourTightness(-1, 1000)).toBeUndefined();
  });

  it("treats zero demand as genuine slack rather than missing data", () => {
    expect(computeLabourTightness(0, 1000)).toBe(0);
  });
});

describe("roundTightness", () => {
  it("keeps three decimals so slack markets stay distinguishable", () => {
    expect(roundTightness(0.4123456)).toBe(0.412);
    expect(roundTightness(0.4187)).toBe(0.419);
  });

  it("leaves large readings intact", () => {
    expect(roundTightness(200.9123)).toBe(200.912);
  });
});

describe("staffingFactorFromTightness", () => {
  it("does not ration a slack market", () => {
    expect(staffingFactorFromTightness(0.4)).toBe(1);
    expect(staffingFactorFromTightness(1)).toBe(1);
  });

  it("halves every sector's headcount when a state is twice oversubscribed", () => {
    expect(staffingFactorFromTightness(2)).toBe(0.5);
  });

  it("rations the live Arizona case down to well under one percent", () => {
    // Tightness ~200: 63.2M jobs wanted against a 314,613 person labour force.
    const factor = staffingFactorFromTightness(200.9);
    expect(factor).toBeLessThan(0.005);
    expect(63_200_000 * factor).toBeLessThan(320_000);
  });

  it("does not ration when tightness is unknown, so missing data never throttles a state", () => {
    expect(staffingFactorFromTightness(undefined)).toBe(1);
    expect(staffingFactorFromTightness(null)).toBe(1);
    expect(staffingFactorFromTightness(Number.NaN)).toBe(1);
    expect(staffingFactorFromTightness(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("ignores a negative tightness rather than inverting the sign of output", () => {
    expect(staffingFactorFromTightness(-3)).toBe(1);
  });
});

describe("filledWorkers", () => {
  it("passes desired headcount straight through in a slack market", () => {
    expect(filledWorkers(1200, 1)).toBe(1200);
  });

  it("staffs the pro rata share when rationed", () => {
    expect(filledWorkers(1000, 0.25)).toBe(250);
  });

  it("floors a rationed sector at one worker rather than abolishing it", () => {
    // A 0 here would divide-by-zero the wagePerWorker derivation downstream.
    expect(filledWorkers(10, 0.001)).toBe(1);
  });

  it("keeps a genuinely empty sector empty", () => {
    expect(filledWorkers(0, 1)).toBe(0);
    expect(filledWorkers(-5, 1)).toBe(0);
    expect(filledWorkers(Number.NaN, 1)).toBe(0);
  });

  it("collapses the Arizona sector from 48M to the state's actual capacity", () => {
    const factor = staffingFactorFromTightness(200.9);
    expect(filledWorkers(47_996_752, factor)).toBeLessThan(250_000);
  });
});

describe("glideStaffingFactor", () => {
  it("starts a sector with no history at full staffing", () => {
    // First turn after this ships, world-wide, with no migration.
    expect(glideStaffingFactor(0.005, undefined)).toBeCloseTo(1 - LABOUR_STAFFING_MAX_TURN_MOVE, 8);
    expect(glideStaffingFactor(0.005, null)).toBeCloseTo(1 - LABOUR_STAFFING_MAX_TURN_MOVE, 8);
  });

  it("never moves more than the per-turn cap in either direction", () => {
    expect(glideStaffingFactor(0, 1)).toBeCloseTo(0.9, 8);
    expect(glideStaffingFactor(1, 0)).toBeCloseTo(0.1, 8);
  });

  it("settles exactly on target instead of overshooting past it", () => {
    expect(glideStaffingFactor(0.95, 1)).toBeCloseTo(0.95, 8);
    expect(glideStaffingFactor(0.42, 0.4)).toBeCloseTo(0.42, 8);
  });

  it("holds still once it has arrived", () => {
    expect(glideStaffingFactor(0.25, 0.25)).toBeCloseTo(0.25, 8);
    expect(glideStaffingFactor(1, 1)).toBe(1);
  });

  it("reaches a fully rationed target within ten turns", () => {
    // The whole point of the ramp: a CEO gets ten turns to divest, relocate or
    // shrink capacity, not one. It must still ARRIVE, or the constraint never
    // actually bites and the exploit keeps paying forever.
    const target = staffingFactorFromTightness(200.9);
    let factor: number | undefined = undefined;
    let turns = 0;
    for (; turns < 50; turns++) {
      const next: number = glideStaffingFactor(target, factor);
      if (factor !== undefined && Math.abs(next - factor) < 1e-9) break;
      factor = next;
    }
    expect(turns).toBeLessThanOrEqual(10);
    expect(factor).toBeCloseTo(target, 8);
  });

  it("recovers symmetrically when a state's labour market frees up", () => {
    let factor = 0.1;
    for (let i = 0; i < 9; i++) factor = glideStaffingFactor(1, factor);
    expect(factor).toBeCloseTo(1, 8);
  });

  it("clamps a corrupt persisted factor into range rather than propagating it", () => {
    expect(glideStaffingFactor(1, 5)).toBe(1);
    expect(glideStaffingFactor(0, -2)).toBe(0);
    expect(glideStaffingFactor(0.5, Number.NaN)).toBeCloseTo(0.9, 8);
  });
});
