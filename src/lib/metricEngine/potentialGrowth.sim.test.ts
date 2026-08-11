import { describe, expect, it } from "vitest";
import { potentialGrowth, LABOR_SHARE, TFP_BASELINE } from "./potentialGrowth";

/**
 * Potential growth must respond to the workforce — the population→GDP payoff
 * (§5.1, success criteria #1/#4). At demographic + capital stationarity it
 * equals TFP; a shrinking workforce drags it down by ~αL per point of decline.
 */
describe("potential growth responds to the workforce (population→GDP, §5.1)", () => {
  it("equals TFP at demographic + capital stationarity", () => {
    expect(potentialGrowth(0, 0, TFP_BASELINE)).toBeCloseTo(TFP_BASELINE, 6);
  });
  it("a 1%/yr workforce decline cuts potential by ~LABOR_SHARE points", () => {
    const drop = TFP_BASELINE - potentialGrowth(-1, 0, TFP_BASELINE);
    expect(drop).toBeCloseTo(LABOR_SHARE, 6);
  });
  it("a growing workforce lifts potential above TFP", () => {
    expect(potentialGrowth(1.5, 0, TFP_BASELINE)).toBeGreaterThan(TFP_BASELINE);
  });
});
