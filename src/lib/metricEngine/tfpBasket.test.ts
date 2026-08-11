import { describe, expect, it } from "vitest";
import { tfpBasket, TFP_REFERENCE_INPUTS, TFP_BOUNDS } from "./potentialGrowth";
import { TFP_BASELINE } from "./potentialGrowth";

describe("tfpBasket (P2d — the living TFP)", () => {
  it("equals TFP_BASELINE exactly at the reference inputs (parity by construction)", () => {
    expect(tfpBasket(TFP_REFERENCE_INPUTS)).toBeCloseTo(TFP_BASELINE, 10);
  });

  it("missing inputs default to their reference (term = 0)", () => {
    expect(tfpBasket({})).toBeCloseTo(TFP_BASELINE, 10);
  });

  it("each term moves TFP in its direction", () => {
    const ref = TFP_REFERENCE_INPUTS;
    expect(tfpBasket({ ...ref, rdIntensity: 4.5 })).toBeGreaterThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, rdIntensity: 0.5 })).toBeLessThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, workforceSkill: 90 })).toBeGreaterThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, workforceSkill: 30 })).toBeLessThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, transportEfficiency: 90 })).toBeGreaterThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, transportEfficiency: 20 })).toBeLessThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, broadbandAccess: 99 })).toBeGreaterThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, broadbandAccess: 50 })).toBeLessThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, powerGridReliability: 99.9 })).toBeGreaterThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, powerGridReliability: 97 })).toBeLessThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, urbanizationRate: 90 })).toBeGreaterThan(TFP_BASELINE);
    expect(tfpBasket({ ...ref, urbanizationRate: 25 })).toBeLessThan(TFP_BASELINE);
  });

  it("urbanization agglomeration SATURATES (audit-C3): gains diminish at high urbanization", () => {
    const ref = TFP_REFERENCE_INPUTS;
    const lowStep =
      tfpBasket({ ...ref, urbanizationRate: 50 }) - tfpBasket({ ...ref, urbanizationRate: 40 });
    const highStep =
      tfpBasket({ ...ref, urbanizationRate: 90 }) - tfpBasket({ ...ref, urbanizationRate: 80 });
    expect(lowStep).toBeGreaterThan(0);
    expect(highStep).toBeGreaterThan(0);
    expect(highStep).toBeLessThan(lowStep); // diminishing marginal agglomeration
  });

  it("is clamped to the TFP bounds at joint extremes", () => {
    const max = tfpBasket({
      rdIntensity: 6,
      workforceSkill: 100,
      transportEfficiency: 100,
      urbanizationRate: 100,
    });
    const min = tfpBasket({
      rdIntensity: 0,
      workforceSkill: 0,
      transportEfficiency: 0,
      urbanizationRate: 0,
    });
    expect(max).toBeLessThanOrEqual(TFP_BOUNDS[1]);
    expect(min).toBeGreaterThanOrEqual(TFP_BOUNDS[0]);
  });

  it("rejects non-finite inputs (falls back to reference)", () => {
    expect(
      tfpBasket({ rdIntensity: NaN, workforceSkill: Infinity, urbanizationRate: NaN })
    ).toBeCloseTo(TFP_BASELINE, 10);
  });
});
