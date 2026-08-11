import { describe, expect, it } from "vitest";
import {
  effectStrength,
  concentrationMultiplier,
  saturation,
  corpAlignmentModifier,
  corpAlignmentLabel,
  synergyNudges,
  spendingEfficiencyMultiplier,
  applySpendingEfficiency,
} from "./effects";
import type { EconomicModelState } from "@/lib/constants/economicModels";

const model = (over: Partial<EconomicModelState> = {}): EconomicModelState => ({
  current: "militaryIndustrial", // primary defense; secondaries manufacturing/technology/chemical_industries
  intensity: 100,
  scores: {} as EconomicModelState["scores"],
  lastUpdated: new Date(0),
  ...over,
});

describe("effectStrength (binary activation)", () => {
  it("is 1 for any active named model — even at low/zero intensity — and 0 for mixed/absent", () => {
    expect(effectStrength(model({ intensity: 100 }))).toBe(1);
    expect(effectStrength(model({ intensity: 8 }))).toBe(1); // low-intensity seeded model still full
    expect(effectStrength(model({ intensity: 0 }))).toBe(1); // intensity no longer gates effects
    expect(effectStrength(model({ current: "mixed" }))).toBe(0);
    expect(effectStrength(undefined)).toBe(0);
  });
});

describe("concentrationMultiplier (§6.1, parity-neutral on mixed/absent, full when active)", () => {
  it("is exactly 1 when the model is absent or mixed", () => {
    expect(concentrationMultiplier(undefined, "defense")).toBe(1);
    expect(concentrationMultiplier(model({ current: "mixed" }), "defense")).toBe(1);
  });

  it("boosts the primary sector more than secondaries, off-model unchanged", () => {
    const m = model();
    const primary = concentrationMultiplier(m, "defense");
    const secondary = concentrationMultiplier(m, "manufacturing");
    const offModel = concentrationMultiplier(m, "agriculture");
    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(1);
    expect(offModel).toBe(1);
    // full strength: primary = 1 + 0.5·sat(1); sat(1) = 1 − 0.5 = 0.5 → 1.25
    expect(primary).toBeCloseTo(1 + 0.5 * saturation(1), 6);
    expect(primary).toBeCloseTo(1.25, 6);
    expect(secondary).toBeCloseTo(1.1, 6); // 1 + 0.2·0.5
  });

  it("is intensity-independent — the boost is the same at any active intensity (binary)", () => {
    const at8 = concentrationMultiplier(model({ intensity: 8 }), "defense");
    const at50 = concentrationMultiplier(model({ intensity: 50 }), "defense");
    const at100 = concentrationMultiplier(model({ intensity: 100 }), "defense");
    expect(at8).toBeCloseTo(at100, 6);
    expect(at50).toBeCloseTo(at100, 6);
  });
});

describe("corpAlignmentModifier (§6.2, signed margin delta, full when active)", () => {
  it("is 0 when the model is absent or mixed", () => {
    expect(corpAlignmentModifier(undefined, "defense")).toBe(0);
    expect(corpAlignmentModifier(model({ current: "mixed" }), "defense")).toBe(0);
  });

  it("rewards primary > secondary, penalizes off-model — full and intensity-independent", () => {
    const full = model();
    expect(corpAlignmentModifier(full, "defense")).toBeCloseTo(0.08, 6); // primary
    expect(corpAlignmentModifier(full, "manufacturing")).toBeCloseTo(0.03, 6); // secondary
    expect(corpAlignmentModifier(full, "agriculture")).toBeCloseTo(-0.02, 6); // off-model
    // same at low intensity (binary activation)
    expect(corpAlignmentModifier(model({ intensity: 8 }), "defense")).toBeCloseTo(0.08, 6);
  });

  it("labels favored / disfavored / neutral", () => {
    const full = model();
    expect(corpAlignmentLabel(full, "defense")).toBe("favored");
    expect(corpAlignmentLabel(full, "manufacturing")).toBe("favored");
    expect(corpAlignmentLabel(full, "agriculture")).toBe("disfavored");
    expect(corpAlignmentLabel(undefined, "defense")).toBe("neutral");
    expect(corpAlignmentLabel(model({ current: "mixed" }), "defense")).toBe("neutral");
  });
});

describe("synergyNudges (§6.3, full when active, parity-neutral on mixed/absent)", () => {
  it("returns the full maxNudge per synergy (signed); empty when absent / mixed", () => {
    const full = synergyNudges(model()); // MIC: militaryReadiness +10, civilLiberties −8
    expect(full.get("militaryReadiness")).toBeCloseTo(10, 6);
    expect(full.get("civilLiberties")).toBeCloseTo(-8, 6);
    // intensity-independent: full at low intensity too
    expect(synergyNudges(model({ intensity: 8 })).get("militaryReadiness")).toBeCloseTo(10, 6);
    expect(synergyNudges(undefined).size).toBe(0);
    expect(synergyNudges(model({ current: "mixed" })).size).toBe(0);
  });
});

describe("spendingEfficiency (§6.4, signature categories only, full when active)", () => {
  // socialMarket signature: healthcare/welfare/socialSecurity.
  const sm = model({ current: "socialMarket", intensity: 100 });

  it("boosts only signature categories; off-signature and no-model are 1", () => {
    expect(spendingEfficiencyMultiplier(sm, "healthcare")).toBeGreaterThan(1);
    expect(spendingEfficiencyMultiplier(sm, "defense")).toBe(1); // off-signature
    expect(spendingEfficiencyMultiplier(undefined, "healthcare")).toBe(1);
    expect(spendingEfficiencyMultiplier(model({ current: "mixed" }), "healthcare")).toBe(1);
    // full strength: 1 + 0.25·sat(1) = 1 + 0.25·0.5 = 1.125
    expect(spendingEfficiencyMultiplier(sm, "healthcare")).toBeCloseTo(1.125, 6);
    // intensity-independent
    expect(
      spendingEfficiencyMultiplier(model({ current: "socialMarket", intensity: 8 }), "healthcare")
    ).toBeCloseTo(1.125, 6);
  });

  it("applySpendingEfficiency scales signature categories and leaves others (identity on no model)", () => {
    const base = { healthcare: 100, defense: 100 };
    const scaled = applySpendingEfficiency(base, sm);
    expect(scaled.healthcare).toBeCloseTo(112.5, 4);
    expect(scaled.defense).toBe(100);
    // parity fast-path: no model → same object reference
    expect(applySpendingEfficiency(base, undefined)).toBe(base);
    expect(applySpendingEfficiency(base, model({ current: "mixed" }))).toBe(base);
  });
});
