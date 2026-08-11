import { describe, it, expect } from "vitest";
import {
  computeMacroTarget,
  resolveMonetaryBaseline,
  applyDrift,
  computeVolumePressure,
  applyVolumePressure,
  applyNoise,
  applyCyclePressure,
  clampRate,
  computeRateUpdate,
} from "./rateCalculation";
import type { MacroInputs, VolumeInputs } from "./rateCalculation";
import { CYCLE_PRESSURE_BY_REGIME } from "@/lib/constants/currencies";

// ── Baselines from currencies.ts for reference ─────────────────────────────
// Monetary baselines: US/UK 3% neutral prime and 2% target, JP 1%/1%.
// Production/trade baselines remain in ECONOMIC_BASELINES.

const neutralUS: MacroInputs = {
  primeRate: 3.0,
  inflationRate: 2.0,
  gdpGrowth: 2.5,
  tradeGrowth: 0,
};
const neutralUK: MacroInputs = {
  primeRate: 3.0,
  inflationRate: 2.0,
  gdpGrowth: 1.5,
  tradeGrowth: 0,
};
const neutralJP: MacroInputs = {
  primeRate: 1.0,
  inflationRate: 1.0,
  gdpGrowth: 1.0,
  tradeGrowth: 0,
};

const zeroVolume: VolumeInputs = { buyVolume24: 0, sellVolume24: 0 };

describe("computeMacroTarget", () => {
  it("returns base rate when all indicators are at baseline (US)", () => {
    expect(computeMacroTarget(1.0, neutralUS, "US")).toBeCloseTo(1.0, 6);
  });

  it("returns base rate when all indicators are at baseline (UK)", () => {
    expect(computeMacroTarget(0.75, neutralUK, "UK")).toBeCloseTo(0.75, 6);
  });

  it("returns base rate when all indicators are at baseline (JP)", () => {
    expect(computeMacroTarget(106.0, neutralJP, "JP")).toBeCloseTo(106.0, 6);
  });

  it("higher prime rate strengthens currency (lowers rate)", () => {
    const inputs: MacroInputs = { ...neutralUS, primeRate: 4.5 }; // +1.5 above baseline
    const target = computeMacroTarget(1.0, inputs, "US");
    // multiplier = 1 - (4.5-3.0)*0.02 = 0.97 -> target = 0.97
    expect(target).toBeCloseTo(0.97, 6);
  });

  it("higher inflation weakens currency (raises rate)", () => {
    const inputs: MacroInputs = { ...neutralUS, inflationRate: 5.0 }; // +3.0 above baseline
    const target = computeMacroTarget(1.0, inputs, "US");
    // multiplier = 1 + (5.0-2.0)*0.015 = 1.045
    expect(target).toBeCloseTo(1.045, 6);
  });

  it("higher GDP growth strengthens currency (lowers rate)", () => {
    const inputs: MacroInputs = { ...neutralUS, gdpGrowth: 5.5 }; // +3.0 above baseline
    const target = computeMacroTarget(1.0, inputs, "US");
    // multiplier = 1 - (5.5-2.5)*0.01 = 0.97
    expect(target).toBeCloseTo(0.97, 6);
  });

  it("positive trade growth strengthens currency (lowers rate)", () => {
    const inputs: MacroInputs = { ...neutralUS, tradeGrowth: 4.0 }; // +4.0 above baseline
    const target = computeMacroTarget(1.0, inputs, "US");
    // multiplier = 1 - (4.0-0)*0.005 = 0.98
    expect(target).toBeCloseTo(0.98, 6);
  });

  it("scales with base rate (JPY)", () => {
    const inputs: MacroInputs = { ...neutralJP, primeRate: 2.0 }; // +1.0 above 1.0 baseline
    const target = computeMacroTarget(106.0, inputs, "JP");
    // multiplier = 1 - 1.0*0.02 = 0.98 -> target = 106 * 0.98 = 103.88
    expect(target).toBeCloseTo(103.88, 2);
  });

  it("combines multiple deviations", () => {
    const inputs: MacroInputs = {
      primeRate: 3.5, // +0.5 -> -0.01
      inflationRate: 4.0, // +2.0 -> +0.03
      gdpGrowth: 3.5, // +1.0 -> -0.01
      tradeGrowth: 2.0, // +2.0 -> -0.01
    };
    const target = computeMacroTarget(1.0, inputs, "US");
    // multiplier = 1 - 0.01 + 0.03 - 0.01 - 0.01 = 1.0
    expect(target).toBeCloseTo(1.0, 6);
  });

  it("treats Brazil's 8% neutral prime as balanced rather than restrictive", () => {
    const target = computeMacroTarget(
      5.0,
      { primeRate: 8.0, inflationRate: 4.0, gdpGrowth: 2.5, tradeGrowth: 2.0 },
      "BR"
    );

    expect(target).toBeCloseTo(5.0, 6);
  });

  it("treats Nigeria's high starting inflation as above target, not normal", () => {
    const target = computeMacroTarget(
      1550,
      { primeRate: 12.0, inflationRate: 22.0, gdpGrowth: 3.0, tradeGrowth: 2.5 },
      "NG"
    );

    expect(target).toBeGreaterThan(1550);
  });

  it("UK inflation shock vs UK baseline weakens GBP (raises rate)", () => {
    const inputs: MacroInputs = { ...neutralUK, inflationRate: 8.0 }; // +6.0 vs 2.0 baseline
    const target = computeMacroTarget(0.75, inputs, "UK");
    // deviation term: 1 + 6*0.015 = 1.09; absolute-inflation penalty: (8-6)*0.015 = 0.03
    // multiplier = 1.12 -> 0.75 * 1.12 = 0.84
    expect(target).toBeCloseTo(0.84, 6);
  });

  it("stagflation (high inflation, weak growth) pushes macro target above base", () => {
    const inputs: MacroInputs = {
      ...neutralUS,
      inflationRate: 7.0, // +5 vs baseline -> +0.075; +1 above 6pp ceiling -> +0.015 abs
      gdpGrowth: 0.5, // -2.0 vs baseline -> +0.02
      tradeGrowth: -3.0, // -3 vs baseline -> +0.015
    };
    const target = computeMacroTarget(1.0, inputs, "US");
    // multiplier = 1 + 0.075 + 0.015 + 0.02 + 0.015 = 1.125
    expect(target).toBeCloseTo(1.125, 6);
  });

  // ── Absolute-inflation depreciation (carry-trade fix, #3064 Phase 2) ─────────
  it("inflation below the 6pp ceiling triggers no absolute penalty", () => {
    // BR baseline targetInflation is 4; at 6% inflation the deviation term applies
    // (+2*0.015) but the absolute penalty is exactly zero at the threshold.
    const atCeiling = computeMacroTarget(
      5.0,
      { primeRate: 8.0, inflationRate: 6.0, gdpGrowth: 2.5, tradeGrowth: 2.0 },
      "BR"
    );
    // multiplier = 1 + (6-4)*0.015 = 1.03 -> 5 * 1.03 = 5.15, no abs penalty added
    expect(atCeiling).toBeCloseTo(5.15, 6);
  });

  it("high-baseline currency at its OWN target still depreciates on absolute inflation", () => {
    // Italy runs targetInflation 15 — the deviation term is zero at 15% inflation,
    // so pre-fix it sat at par. The absolute penalty now weakens it: (15-6)*0.015 = 0.135.
    const target = computeMacroTarget(
      800,
      { primeRate: 12.0, inflationRate: 15.0, gdpGrowth: 2.5, tradeGrowth: 0 },
      "IT"
    );
    // deviation term nets 0 (prime 12 == neutral 12, inflation 15 == target 15);
    // only the absolute penalty applies -> multiplier 1.135 -> 800 * 1.135 = 908
    expect(target).toBeCloseTo(908, 0);
    expect(target).toBeGreaterThan(800);
  });
});

describe("applyDrift", () => {
  it("moves 5% toward target each turn", () => {
    // currentRate = 1.0, target = 2.0 -> drifted = 1.0 + (2.0-1.0)*0.05 = 1.05
    expect(applyDrift(1.0, 2.0)).toBeCloseTo(1.05, 6);
  });

  it("no drift when current equals target", () => {
    expect(applyDrift(1.0, 1.0)).toBeCloseTo(1.0, 6);
  });

  it("drifts downward when target is below current", () => {
    // currentRate = 1.0, target = 0.8 -> drifted = 1.0 + (0.8-1.0)*0.05 = 0.99
    expect(applyDrift(1.0, 0.8)).toBeCloseTo(0.99, 6);
  });

  it("converges toward target over many turns", () => {
    let rate = 1.0;
    const target = 1.5;
    for (let i = 0; i < 48; i++) {
      rate = applyDrift(rate, target);
    }
    // After 48 turns at 0.05 drift: 1 - (1-0.05)^48 ~ 91.5% convergence
    // rate should be close to 1.0 + 0.5*0.915 = 1.457
    expect(rate).toBeGreaterThan(1.45);
    expect(rate).toBeLessThan(1.5);
  });
});

describe("computeVolumePressure", () => {
  it("returns 0 when buy equals sell", () => {
    expect(computeVolumePressure({ buyVolume24: 1000, sellVolume24: 1000 })).toBe(0);
  });

  it("returns 0 when both are 0", () => {
    expect(computeVolumePressure(zeroVolume)).toBe(0);
  });

  it("positive net volume produces positive pressure", () => {
    // net = 10000, rawPressure = 10000 * 0.0001 = 1.0 -> capped at 0.05
    const pressure = computeVolumePressure({ buyVolume24: 10000, sellVolume24: 0 });
    expect(pressure).toBe(0.05);
  });

  it("negative net volume produces negative pressure", () => {
    const pressure = computeVolumePressure({ buyVolume24: 0, sellVolume24: 10000 });
    expect(pressure).toBe(-0.05);
  });

  it("small volume stays under cap", () => {
    // net = 100, rawPressure = 100 * 0.0001 = 0.01
    const pressure = computeVolumePressure({ buyVolume24: 200, sellVolume24: 100 });
    expect(pressure).toBeCloseTo(0.01, 6);
  });

  it("caps at +5%", () => {
    const pressure = computeVolumePressure({ buyVolume24: 1000000, sellVolume24: 0 });
    expect(pressure).toBe(0.05);
  });

  it("caps at -5%", () => {
    const pressure = computeVolumePressure({ buyVolume24: 0, sellVolume24: 1000000 });
    expect(pressure).toBe(-0.05);
  });
});

describe("applyVolumePressure", () => {
  it("no change with zero volume", () => {
    expect(applyVolumePressure(1.0, zeroVolume)).toBeCloseTo(1.0, 6);
  });

  it("decreases rate with net buying (buying strengthens currency)", () => {
    // net = 100, pressure = 0.01, rate = 1.0 * (1 - 0.01) = 0.99
    const result = applyVolumePressure(1.0, { buyVolume24: 200, sellVolume24: 100 });
    expect(result).toBeCloseTo(0.99, 4);
  });
});

describe("applyNoise", () => {
  it("applies explicit noise value", () => {
    expect(applyNoise(1.0, 0.001)).toBeCloseTo(1.001, 6);
  });

  it("zero noise returns same rate", () => {
    expect(applyNoise(1.0, 0)).toBeCloseTo(1.0, 6);
  });

  it("negative noise decreases rate", () => {
    expect(applyNoise(1.0, -0.002)).toBeCloseTo(0.998, 6);
  });

  it("volatilityMultiplier scales the jitter (leading-currency buff)", () => {
    // Half volatility → half the offset from the base rate.
    expect(applyNoise(1.0, 0.002, 0.5)).toBeCloseTo(1.001, 6);
    expect(applyNoise(1.0, -0.002, 0.5)).toBeCloseTo(0.999, 6);
    // Zero multiplier fully stabilises the rate.
    expect(applyNoise(1.0, 0.003, 0)).toBeCloseTo(1.0, 6);
    // Default multiplier is unchanged behaviour.
    expect(applyNoise(1.0, 0.002)).toBeCloseTo(1.002, 6);
  });
});

describe("clampRate", () => {
  it("passes through rate within bounds", () => {
    expect(clampRate(1.0, 1.0)).toBeCloseTo(1.0, 6);
  });

  it("clamps to floor (50% of base)", () => {
    expect(clampRate(0.3, 1.0)).toBeCloseTo(0.5, 6);
  });

  it("clamps to ceiling (150% of base)", () => {
    expect(clampRate(2.0, 1.0)).toBeCloseTo(1.5, 6);
  });

  it("works with JPY-scale base rate", () => {
    // base = 106, floor = 53, ceiling = 159
    expect(clampRate(40.0, 106.0)).toBeCloseTo(53.0, 6);
    expect(clampRate(200.0, 106.0)).toBeCloseTo(159.0, 6);
    expect(clampRate(106.0, 106.0)).toBeCloseTo(106.0, 6);
  });
});

describe("computeRateUpdate (full pipeline)", () => {
  it("returns base rate with neutral inputs and zero noise", () => {
    const result = computeRateUpdate(1.0, 1.0, "US", neutralUS, zeroVolume, 0);
    // macro target = 1.0, drift = 1.0 + (1.0-1.0)*DRIFT_SPEED = 1.0, no volume, no noise
    expect(result.rate).toBeCloseTo(1.0, 6);
    expect(result.macroTarget).toBeCloseTo(1.0, 6);
    expect(result.volumePressure).toBe(0);
  });

  it("drifts toward stronger rate (lower rate) with high prime rate", () => {
    const macro: MacroInputs = { ...neutralUS, primeRate: 4.5 };
    const result = computeRateUpdate(1.0, 1.0, "US", macro, zeroVolume, 0);
    // macroTarget = 0.97, drift = 1.0 + (0.97-1.0)*0.05 = 0.9985
    expect(result.rate).toBeCloseTo(0.9985, 4);
    expect(result.macroTarget).toBeCloseTo(0.97, 4);
  });

  it("clamps result to guardrails", () => {
    // Extreme inflationary conditions push macro target well above the ceiling
    const macro: MacroInputs = {
      primeRate: 0,
      inflationRate: 100,
      gdpGrowth: 0,
      tradeGrowth: 0,
    };
    const result = computeRateUpdate(1.5, 1.0, "US", macro, zeroVolume, 0);
    expect(result.rate).toBeCloseTo(1.5, 4); // ceiling = baseRate * 1.5
  });

  it("includes volume pressure in result", () => {
    const volumes: VolumeInputs = { buyVolume24: 200, sellVolume24: 100 };
    const result = computeRateUpdate(1.0, 1.0, "US", neutralUS, volumes, 0);
    expect(result.volumePressure).toBeCloseTo(0.01, 6);
    // Volume pressure (0.01) weighted at 20% → rate = 1.0 * (1 - 0.01 * 0.2) = 0.998
    expect(result.rate).toBeCloseTo(0.998, 3);
  });

  it("handles JPY-scale values", () => {
    const result = computeRateUpdate(106.0, 106.0, "JP", neutralJP, zeroVolume, 0);
    expect(result.rate).toBeCloseTo(106.0, 2);
  });

  it("high inflation raises macroTarget and first-step drift (no noise)", () => {
    const macro: MacroInputs = { ...neutralUS, inflationRate: 8.0 }; // +6 vs 2% baseline
    const result = computeRateUpdate(1.0, 1.0, "US", macro, zeroVolume, 0);
    // deviation 1 + 6*0.015 = 1.09; absolute penalty (8-6)*0.015 = 0.03 -> 1.12;
    // drift: 1 + (1.12-1)*0.05 = 1.006
    expect(result.macroTarget).toBeCloseTo(1.12, 6);
    expect(result.rate).toBeCloseTo(1.006, 4);
  });

  it("macro weakness plus net selling pressure compounds depreciation (capped volume)", () => {
    const macro: MacroInputs = { ...neutralUS, inflationRate: 6.0 }; // weaker macro
    const heavySell: VolumeInputs = { buyVolume24: 0, sellVolume24: 500_000 }; // pressure -> -0.05 cap
    const result = computeRateUpdate(1.0, 1.0, "US", macro, heavySell, 0);
    expect(result.volumePressure).toBe(-0.05);
    // Selling (negative pressure) → rate * (1 - (-0.05) * 0.2) = rate * 1.01 → compounds depreciation
    const driftOnly = applyDrift(1.0, computeMacroTarget(1.0, macro, "US"));
    const withVol = driftOnly * (1 - -0.05 * 0.2);
    expect(result.rate).toBeCloseTo(withVol, 4);
  });

  it("simulated year of drift toward inflation-weakened target moves rate materially", () => {
    const macro: MacroInputs = { ...neutralUS, inflationRate: 10.0 };
    const target = computeMacroTarget(1.0, macro, "US");
    let rate = 1.0;
    for (let i = 0; i < 48; i++) {
      const step = computeRateUpdate(rate, 1.0, "US", macro, zeroVolume, 0);
      rate = step.rate;
    }
    // High inflation weakens currency — rate should drift above base
    expect(target).toBeGreaterThan(1.1);
    expect(rate).toBeGreaterThan(1.0);
    expect(rate).toBeLessThan(target * 1.15);
  });
});

describe("applyCyclePressure", () => {
  it("strengthens the currency (lowers rate) on positive pressure", () => {
    expect(applyCyclePressure(1.0, CYCLE_PRESSURE_BY_REGIME.moderate_strengthen)).toBeCloseTo(
      0.9985,
      6
    );
  });

  it("weakens the currency (raises rate) on negative pressure", () => {
    expect(applyCyclePressure(1.0, CYCLE_PRESSURE_BY_REGIME.moderate_weaken)).toBeCloseTo(
      1.0015,
      6
    );
  });

  it("is a no-op for the neutral regime", () => {
    expect(applyCyclePressure(1.0, CYCLE_PRESSURE_BY_REGIME.neutral)).toBe(1.0);
  });
});

describe("computeRateUpdate cycle pressure", () => {
  const neutralUS: MacroInputs = { primeRate: 3, inflationRate: 2, gdpGrowth: 2.5, tradeGrowth: 2 };
  const zeroVolume: VolumeInputs = { buyVolume24: 0, sellVolume24: 0 };

  it("a sustained strengthen regime settles a few % below target (fundamentals overcome it)", () => {
    let rate = 1.0;
    for (let i = 0; i < 200; i++) {
      // noise=0 for determinism; constant moderate strengthen pressure
      rate = computeRateUpdate(
        rate,
        1.0,
        "US",
        neutralUS,
        zeroVolume,
        0,
        1,
        CYCLE_PRESSURE_BY_REGIME.moderate_strengthen
      ).rate;
    }
    // Equilibrium ≈ target/(1 + p/DRIFT_SPEED) = 1/1.03 ≈ 0.971 — a small, bounded
    // offset, NOT a runaway: a real fundamental move would dominate it.
    expect(rate).toBeGreaterThan(0.96);
    expect(rate).toBeLessThan(0.98);
  });

  it("mirrors for a weaken regime (settles a few % above target)", () => {
    let rate = 1.0;
    for (let i = 0; i < 200; i++) {
      rate = computeRateUpdate(
        rate,
        1.0,
        "US",
        neutralUS,
        zeroVolume,
        0,
        1,
        CYCLE_PRESSURE_BY_REGIME.moderate_weaken
      ).rate;
    }
    expect(rate).toBeGreaterThan(1.02);
    expect(rate).toBeLessThan(1.04);
  });
});

describe("era-aware monetary baselines (current in-game year)", () => {
  it("resolves IT's inflation target/neutral rate to the 1953 era values at an in-game year of 1953", () => {
    const era = resolveMonetaryBaseline("IT", 1953);
    // monetaryEra.ts: IT 1953 = miracolo economico era, NOT the late-1970s 15%.
    expect(era.targetInflation).toBe(2.5);
    expect(era.neutralPrimeRate).toBe(4.0);
  });

  it("bloc budget-only countries resolve era anchors at 1953-era years (YU no longer targets 15%)", () => {
    expect(resolveMonetaryBaseline("YU", 1953).targetInflation).toBe(5.0);
    expect(resolveMonetaryBaseline("YU").targetInflation).toBe(15.0); // modern unchanged
    expect(resolveMonetaryBaseline("BLR", 1953).targetInflation).toBe(0.5);
    expect(resolveMonetaryBaseline("DD", 1953).targetInflation).toBe(0.5);
  });

  it("keeps IT's modern (late-1970s-calibrated) baseline at modern years and when no year is passed", () => {
    expect(resolveMonetaryBaseline("IT", 2019).targetInflation).toBe(15.0);
    expect(resolveMonetaryBaseline("IT").targetInflation).toBe(15.0);
    expect(resolveMonetaryBaseline("IT", null).targetInflation).toBe(15.0);
  });

  it("computeMacroTarget judges the inflation gap against the era target at an in-game year of 1953 (JP)", () => {
    // Inputs pinned exactly at JP's 1953 era anchors (target 2.0, neutral 5.5)
    // and modern economic baselines (gdpGrowth 1.0, tradeGrowth 0).
    const eraNeutralJP: MacroInputs = {
      primeRate: 5.5,
      inflationRate: 2.0,
      gdpGrowth: 1.0,
      tradeGrowth: 0,
    };
    // In-game year 1953: all deviations are zero → target === baseRate exactly.
    expect(computeMacroTarget(360.0, eraNeutralJP, "JP", 1953)).toBeCloseTo(360.0, 6);
    // Modern world with the SAME inputs: judged against JP's modern 1%/1%
    // baselines → prime +4.5pp (strengthen −0.09), inflation +1pp (weaken +0.015).
    expect(computeMacroTarget(360.0, eraNeutralJP, "JP")).toBeCloseTo(360.0 * 0.925, 6);
  });

  it("computeMacroTarget is byte-identical for modern worlds regardless of a modern in-game year", () => {
    expect(computeMacroTarget(1.0, neutralUS, "US", 2019)).toBe(
      computeMacroTarget(1.0, neutralUS, "US")
    );
  });

  it("computeRateUpdate threads the current in-game year through to the macro target", () => {
    const eraNeutralJP: MacroInputs = {
      primeRate: 5.5,
      inflationRate: 2.0,
      gdpGrowth: 1.0,
      tradeGrowth: 0,
    };
    const withEra = computeRateUpdate(360, 360, "JP", eraNeutralJP, zeroVolume, 0, 1, 0, 1953);
    const modern = computeRateUpdate(360, 360, "JP", eraNeutralJP, zeroVolume, 0, 1, 0);
    expect(withEra.macroTarget).toBeCloseTo(360.0, 6);
    expect(modern.macroTarget).toBeCloseTo(360.0 * 0.925, 6);
  });

  it("GRADUATION: baselines re-key as a world's clock advances through the eras", () => {
    // A 1953-default world later in its life:
    expect(resolveMonetaryBaseline("IT", 1955).targetInflation).toBe(2.5); // 1953 era
    expect(resolveMonetaryBaseline("IT", 1985).targetInflation).toBe(15.0); // 1979 era
    expect(resolveMonetaryBaseline("IT", 1995).targetInflation).toBe(5.5); // 1991 era
    expect(resolveMonetaryBaseline("IT", 2020).targetInflation).toBe(15.0); // modern
    // The live 1991-default world at in-game ~2015 is judged against the
    // MODERN baselines — identical to its pre-era-table FX behavior.
    expect(resolveMonetaryBaseline("US", 2015)).toBe(
      resolveMonetaryBaseline("US") // modern resolution
    );
    expect(computeMacroTarget(1.0, neutralUS, "US", 2015)).toBe(
      computeMacroTarget(1.0, neutralUS, "US")
    );
  });
});
