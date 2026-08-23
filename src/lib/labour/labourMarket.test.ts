import { describe, expect, it } from "vitest";
import {
  accumulateLabourDemand,
  computeLabourTightness,
  makeLabourDemandByState,
  roundTightness,
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
