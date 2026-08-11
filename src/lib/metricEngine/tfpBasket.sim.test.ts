import { describe, expect, it } from "vitest";
import {
  tfpBasket,
  potentialGrowth,
  TFP_REFERENCE_INPUTS,
  TFP_BASELINE,
  TFP_BOUNDS,
} from "./potentialGrowth";

/**
 * P2d growth-band + monotonicity sims: the TFP basket keeps potential growth in
 * a sane band over realistic input spreads, capital improvements lift growth
 * monotonically, and the C3 damping holds (saturation is unit-tested; here we
 * assert the LOOP-relevant property — bounded TFP response to urbanization).
 */
describe("TFP basket — growth band + monotonicity (P2d)", () => {
  it("TFP stays within a sane band across realistic seeded spreads", () => {
    // Realistic worst/best joint cases (THRESHOLDS corners).
    const worst = tfpBasket({
      rdIntensity: 0.5,
      workforceSkill: 30,
      transportEfficiency: 20,
      broadbandAccess: 50,
      powerGridReliability: 97,
      urbanizationRate: 25,
    });
    const best = tfpBasket({
      rdIntensity: 4.5,
      workforceSkill: 90,
      transportEfficiency: 90,
      broadbandAccess: 99,
      powerGridReliability: 99.9,
      urbanizationRate: 92,
    });
    expect(worst).toBeGreaterThanOrEqual(TFP_BOUNDS[0]);
    expect(best).toBeLessThanOrEqual(TFP_BOUNDS[1]);
    // The realistic spread is meaningful but bounded (±~1.2pp around baseline).
    expect(best - worst).toBeGreaterThan(0.8);
    expect(best - worst).toBeLessThan(2.5);
  });

  it("human/physical-capital improvements lift POTENTIAL growth monotonically", () => {
    const gL = 0.4;
    const gK = 2.0;
    const base = potentialGrowth(gL, gK, tfpBasket(TFP_REFERENCE_INPUTS));
    const educated = potentialGrowth(
      gL,
      gK,
      tfpBasket({ ...TFP_REFERENCE_INPUTS, workforceSkill: 85 })
    );
    const wired = potentialGrowth(
      gL,
      gK,
      tfpBasket({ ...TFP_REFERENCE_INPUTS, broadbandAccess: 95, transportEfficiency: 80 })
    );
    const research = potentialGrowth(
      gL,
      gK,
      tfpBasket({ ...TFP_REFERENCE_INPUTS, rdIntensity: 4 })
    );
    expect(educated).toBeGreaterThan(base);
    expect(wired).toBeGreaterThan(base);
    expect(research).toBeGreaterThan(base);
    // …and the baseline case reproduces the P1c flat-TFP potential exactly.
    expect(base).toBeCloseTo(potentialGrowth(gL, gK, TFP_BASELINE), 10);
  });

  it("the urbanization→TFP response is bounded (C3: no runaway gain at high urbanization)", () => {
    // Sweep urbanization upward: total TFP gain from 55→100 stays small (the
    // saturating term), so the urbanization↔productivity↔GDP loop cannot
    // self-amplify even before urbanization itself is animated (P3).
    const atRef = tfpBasket(TFP_REFERENCE_INPUTS);
    const atMax = tfpBasket({ ...TFP_REFERENCE_INPUTS, urbanizationRate: 100 });
    expect(atMax - atRef).toBeGreaterThan(0);
    expect(atMax - atRef).toBeLessThan(0.25); // bounded marginal headroom
  });
});
