import { describe, expect, it } from "vitest";
import { presentEconomicModel } from "./present";
import type { EconomicModelState } from "@/lib/constants/economicModels";

const base = (over: Partial<EconomicModelState> = {}): EconomicModelState => ({
  current: "militaryIndustrial",
  intensity: 62.4,
  scores: {} as EconomicModelState["scores"],
  drivers: { sector: 0.7, spend: 0.5, law: 0 },
  lastUpdated: new Date(0),
  ...over,
});

describe("presentEconomicModel", () => {
  it("maps id → name, rounds intensity, and bands it", () => {
    const v = presentEconomicModel(base());
    expect(v.currentName).toBe("Military-Industrial Complex");
    expect(v.intensity).toBe(62); // rounded
    expect(v.band).toBe("Established"); // 55–75
    expect(v.signatureSectors[0]).toBe("Defense"); // primary first
    expect(v.signatureSectors.length).toBe(4); // primary + 3 secondaries
  });

  it("surfaces the challenger with its name + the switch window", () => {
    const v = presentEconomicModel(
      base({ challenger: { modelId: "techInnovation", turnsLeading: 20 } })
    );
    expect(v.challenger?.name).toBe("Tech-Innovation Economy");
    expect(v.challenger?.turnsLeading).toBe(20);
    expect(v.challenger?.switchTurns).toBe(48);
  });

  it("renders mixed as Mixed with no signature sectors (and no effects)", () => {
    const v = presentEconomicModel(base({ current: "mixed", intensity: 0 }));
    expect(v.currentName).toBe("Mixed / Balanced Economy");
    expect(v.band).toBe("Mixed");
    expect(v.signatureSectors).toEqual([]);
    expect(v.effects).toBeUndefined();
  });

  it("shows the active model's bonuses/debuffs at FULL strength regardless of intensity", () => {
    const v = presentEconomicModel(base()); // militaryIndustrial, intensity 62.4 (any active intensity)
    expect(v.effects).toBeDefined();
    expect(v.effects!.corpMarginFavoredPct).toBeCloseTo(8, 5); // full primary
    expect(v.effects!.corpMarginSecondaryPct).toBeCloseTo(3, 5); // full secondary
    expect(v.effects!.corpMarginOffModelPct).toBeCloseTo(-2, 5); // full off-model penalty
    expect(v.effects!.sectorGdpWeightPct).toBeCloseTo(25, 5); // 1.25 → +25%
    expect(v.effects!.secondaryGdpWeightPct).toBeCloseTo(10, 5); // 1.10 → +10%
    expect(v.effects!.secondaryGdpWeightPct).toBeLessThan(v.effects!.sectorGdpWeightPct);
    // MIC synergies → militaryReadiness (+), civilLiberties (−), with display labels
    expect(v.effects!.synergies).toHaveLength(2);
    const military = v.effects!.synergies.find((s) => /military/i.test(s.label));
    expect(military && military.delta).toBeGreaterThan(0);
    expect(v.effects!.synergies.some((s) => s.delta < 0)).toBe(true);
  });

  it("the bonuses are intensity-independent — a low-intensity active model shows the same full values", () => {
    const low = presentEconomicModel(base({ intensity: 8 }));
    const high = presentEconomicModel(base({ intensity: 90 }));
    expect(low.effects).toEqual(high.effects);
    expect(low.intensity).toBe(8); // but the fit readout still tracks the real intensity
    expect(high.intensity).toBe(90);
  });

  it("omits the spending-efficiency line for a model with no spending signature", () => {
    // financialized has an empty spendingSignature.
    const v = presentEconomicModel(base({ current: "financialized", intensity: 80 }));
    expect(v.effects!.spendingEfficiencyPct).toBe(0);
  });
});
