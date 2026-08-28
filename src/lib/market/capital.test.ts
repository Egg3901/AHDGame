import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  advanceCapitalStock,
  capitalUtilizationFactor,
  CAPITAL_DEPRECIATION_PER_TURN,
  CAPITAL_SEED_HEADROOM,
  impliedOutputUnits,
  seedCapitalStock,
} from "./capital";

const base = { iron: 120, coal: 150 } as Record<CommodityType, number>;

describe("impliedOutputUnits", () => {
  it("is Σ revenue×rate/base over the output mix", () => {
    expect(impliedOutputUnits(24_000, { iron: 0.5 }, base, 1)).toBe(100);
    expect(impliedOutputUnits(24_000, { iron: 0.5, coal: 0.25 }, base, 1)).toBe(140);
  });
  it("guards zero/negative revenue and zero base prices", () => {
    expect(impliedOutputUnits(0, { iron: 0.5 }, base, 1)).toBe(0);
    expect(impliedOutputUnits(-5, { iron: 0.5 }, base, 1)).toBe(0);
    expect(
      impliedOutputUnits(24_000, { iron: 0.5 }, { iron: 0 } as Record<CommodityType, number>, 1)
    ).toBe(0);
  });
});

describe("seedCapitalStock", () => {
  it("seeds with 10% headroom over implied output", () => {
    expect(seedCapitalStock(24_000, { iron: 0.5 }, base, 1)).toBeCloseTo(
      100 * CAPITAL_SEED_HEADROOM,
      10
    );
  });
});

describe("advanceCapitalStock", () => {
  it("grows with investment", () => {
    expect(advanceCapitalStock({ prevStock: 100, currentGrowthRate: 1 })).toBeCloseTo(
      100 * (1.01 - CAPITAL_DEPRECIATION_PER_TURN),
      10
    );
  });
  it("decays by exactly the depreciation rate with zero investment", () => {
    expect(advanceCapitalStock({ prevStock: 100, currentGrowthRate: 0 })).toBeCloseTo(
      100 * (1 - CAPITAL_DEPRECIATION_PER_TURN),
      10
    );
  });
  it("floors at zero and treats garbage stock as zero", () => {
    expect(advanceCapitalStock({ prevStock: NaN, currentGrowthRate: 5 })).toBe(0);
    expect(advanceCapitalStock({ prevStock: -10, currentGrowthRate: 0 })).toBe(0);
  });
});

describe("capitalUtilizationFactor", () => {
  it("caps at 1 with spare capacity and scales below", () => {
    expect(capitalUtilizationFactor(200, 100)).toBe(1);
    expect(capitalUtilizationFactor(50, 100)).toBe(0.5);
  });
  it("is 1 with nothing to produce, 0 with expected output and no capital", () => {
    expect(capitalUtilizationFactor(0, 0)).toBe(1);
    expect(capitalUtilizationFactor(0, 100)).toBe(0);
    expect(capitalUtilizationFactor(NaN, 100)).toBe(0);
  });
});

import { advanceCapitalBookAnchor } from "./capital";

describe("advanceCapitalBookAnchor", () => {
  it("seeds at current NPV on first exposure (flip = no-op)", () => {
    expect(advanceCapitalBookAnchor({ prevAnchor: null, sectorNPV: 1000 })).toBe(1000);
    expect(advanceCapitalBookAnchor({ prevAnchor: 0, sectorNPV: 1000 })).toBe(1000);
  });
  it("ratchets up when NPV rises above the anchor", () => {
    expect(advanceCapitalBookAnchor({ prevAnchor: 1000, sectorNPV: 1500 })).toBe(1500);
  });
  it("holds (barely decayed) when NPV falls below the anchor", () => {
    // prev 1000 decays by 0.0005 → 999.5, still above the depressed NPV 400.
    expect(advanceCapitalBookAnchor({ prevAnchor: 1000, sectorNPV: 400 })).toBeCloseTo(999.5, 6);
  });
  it("bleeds down over sustained mild impairment via the decay factor", () => {
    // NPV 900 stays within the 5x cap, so the slow decay governs the ratchet-down.
    let a = 1000;
    for (let i = 0; i < 100; i++) a = advanceCapitalBookAnchor({ prevAnchor: a, sectorNPV: 900 });
    expect(a).toBeCloseTo(1000 * Math.pow(1 - 0.0005, 100), 4);
    expect(a).toBeLessThan(1000);
    expect(a).toBeGreaterThan(900);
  });
  it("caps the anchor at a multiple of current NPV (kills the ghost high-water mark)", () => {
    // prev 1000 vs NPV 100 is a 10x impairment: the slow decay would hold it near
    // 999.5 for ever, but the cap snaps it to 5 x NPV = 500.
    expect(advanceCapitalBookAnchor({ prevAnchor: 1000, sectorNPV: 100 })).toBe(500);
  });
  it("snaps a zero-earnings sector to no going-concern book", () => {
    // NPV 0 → cap 0. A plant earning nothing has no going-concern value, so it
    // must not carry a book, however high its early-life peak was.
    let a = 1_000_000;
    for (let i = 0; i < 3; i++) a = advanceCapitalBookAnchor({ prevAnchor: a, sectorNPV: 0 });
    expect(a).toBe(0);
  });
  it("honors a custom depreciation rate within the cap", () => {
    // NPV 500 keeps the 5x cap (2500) non-binding, so the custom 0.1 decay shows.
    expect(
      advanceCapitalBookAnchor({ prevAnchor: 1000, sectorNPV: 500, depreciationPerTurn: 0.1 })
    ).toBeCloseTo(900, 6);
  });
});

import {
  softenedMarketRealization,
  softenedMarketRealizationAmount,
  governorEffectiveCap,
  MARKET_REALIZATION_DEVIATION_CAP,
  MARKET_REALIZATION_RAMP_TURNS,
} from "./capital";

describe("governorEffectiveCap (C8: the cap widens with the ramp)", () => {
  const cap = MARKET_REALIZATION_DEVIATION_CAP;

  it("is the configured cap at lambda 0 and releases entirely at full ramp", () => {
    expect(governorEffectiveCap(cap, 0)).toBeCloseTo(cap, 12);
    expect(governorEffectiveCap(cap, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(governorEffectiveCap(cap, 1.5)).toBe(Number.POSITIVE_INFINITY);
  });

  it("bounds the BLENDED deviation at exactly the configured cap at half ramp", () => {
    // The designed calibration point: lambda * capEffective(lambda) === cap at
    // lambda = 0.5, so a mid-ramp world is governed exactly as tightly as the
    // old constant-cap world was.
    expect(0.5 * governorEffectiveCap(cap, 0.5)).toBeCloseTo(cap, 12);
  });

  it("is TIGHTER than the old constant cap for the first half of the ramp", () => {
    for (const lambda of [0.1, 0.25, 0.4]) {
      expect(lambda * governorEffectiveCap(cap, lambda)).toBeLessThan(cap);
    }
  });

  it("widens monotonically", () => {
    let prev = -Infinity;
    for (const lambda of [0, 0.2, 0.5, 0.8, 0.95]) {
      const c = governorEffectiveCap(cap, lambda);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });
});

describe("softenedMarketRealization (launch-safety governor)", () => {
  it("is a no-op on the flip turn (since = 0 -> returns the ledger factor exactly)", () => {
    // startTurn == currentTurn: lambda = 0, so the market factor never applies.
    expect(softenedMarketRealization(0.8, 0.6, 100, 100)).toBe(0.8);
    expect(softenedMarketRealization(1.2, 2.0, 5, 5)).toBe(1.2);
  });

  it("treats null start/current turns as no elapsed time (no-op)", () => {
    expect(softenedMarketRealization(0.9, 0.5, null, null)).toBe(0.9);
    // currentTurn defaults to 0, startTurn defaults to now => since = 0.
    expect(softenedMarketRealization(0.9, 0.5, null, 0)).toBe(0.9);
  });

  it("applies the fully-ramped market factor after RAMP_TURNS", () => {
    expect(softenedMarketRealization(1, 1.05, 0, MARKET_REALIZATION_RAMP_TURNS)).toBeCloseTo(
      1.05,
      6
    );
  });

  /**
   * C8. A constant +/-CAP never turned itself off, so the market factor could
   * never move revenue more than 15% from the legacy baseline no matter how
   * long the world had run — the entire physical layer was cosmetic beyond that
   * band. At full ramp the governor is now INERT and the market factor stands.
   */
  it("is inert at full ramp — the market factor passes through unclamped", () => {
    const rt = MARKET_REALIZATION_RAMP_TURNS;
    expect(softenedMarketRealization(1, 5, 0, rt)).toBeCloseTo(5, 6);
    expect(softenedMarketRealization(1, 0.01, 0, rt)).toBeCloseTo(0.01, 6);
    expect(softenedMarketRealization(2, 10, 0, rt)).toBeCloseTo(10, 6);
  });

  it("still clamps hard mid-ramp", () => {
    const rt = MARKET_REALIZATION_RAMP_TURNS;
    const cap = MARKET_REALIZATION_DEVIATION_CAP;
    // lambda = 0.5 -> blended deviation bounded by exactly `cap`.
    expect(softenedMarketRealization(1, 99, 0, rt / 2)).toBeCloseTo(1 + cap, 6);
    expect(softenedMarketRealization(1, 0, 0, rt / 2)).toBe(1); // factor variant: 0 -> lf
    // A quarter ramp is tighter still.
    expect(softenedMarketRealization(1, 99, 0, rt / 4)).toBeLessThan(1 + cap);
  });

  it("ramps an in-cap divergence in linearly from zero", () => {
    const rt = MARKET_REALIZATION_RAMP_TURNS;
    // mf = 1.05 is inside the cap at every lambda here, so the result is a
    // plain linear blend and the ramp shape is visible on its own.
    expect(softenedMarketRealization(1, 1.05, 0, rt / 2)).toBeCloseTo(1 + 0.5 * 0.05, 6);
    expect(softenedMarketRealization(1, 1.05, 0, rt / 4)).toBeCloseTo(1 + 0.25 * 0.05, 6);
  });

  it("caps lambda at 1 past the ramp window (no overshoot)", () => {
    const rt = MARKET_REALIZATION_RAMP_TURNS;
    expect(softenedMarketRealization(1, 1.5, 0, rt * 3)).toBeCloseTo(1.5, 6);
  });

  it("returns the ledger baseline for degenerate FACTORS", () => {
    const rt = MARKET_REALIZATION_RAMP_TURNS;
    // marketFactor <= 0 -> mf defaults to lf -> always lf. Right for a factor,
    // and exactly wrong for an amount — hence the split, pinned below.
    expect(softenedMarketRealization(1, 0, 0, rt)).toBe(1);
    expect(softenedMarketRealization(1, -3, 0, rt)).toBe(1);
    // ledgerFactor <= 0 / non-finite -> lf defaults to 1.
    expect(softenedMarketRealization(0, 0.5, 0, rt)).toBeCloseTo(0.5, 6);
    expect(softenedMarketRealization(Number.NaN, 2, 0, rt)).toBeCloseTo(2, 6);
  });

  it("honors custom cap and ramp arguments; guards invalid ones", () => {
    // Custom cap 0.5 with a custom ramp of 10: at half that ramp the blended
    // deviation is bounded by 0.5.
    expect(softenedMarketRealization(1, 99, 0, 5, 0.5, 10)).toBeCloseTo(1.5, 6);
    // Invalid rampTurns (< 1) falls back to the default window (so 10 turns is early).
    const early = softenedMarketRealization(1, 2, 0, 10, 0.15, 0);
    expect(early).toBeGreaterThan(1);
    expect(early).toBeLessThan(1.15);
    // Negative cap falls back to the default cap (visible mid-ramp).
    expect(softenedMarketRealization(1, 99, 0, MARKET_REALIZATION_RAMP_TURNS / 2, -1)).toBeCloseTo(
      1 + MARKET_REALIZATION_DEVIATION_CAP,
      6
    );
  });
});

/**
 * C5 REGRESSION (ship-blocker). The plants revenue leg called the FACTOR helper
 * with revenue AMOUNTS. Its `<= 0` fallback substitutes the baseline, so a
 * sector that produced nothing was paid its full baseline revenue while its
 * costs correctly went to ~0 — roughly a 6x profit pump for halting a plant —
 * and the boundary was discontinuous: an epsilon of output earned 85% of
 * nameplate, exactly zero earned 100%.
 */
describe("softenedMarketRealizationAmount (C5: zero means zero)", () => {
  const rt = MARKET_REALIZATION_RAMP_TURNS;

  it("pays a fully halted, fully ramped plant exactly nothing", () => {
    expect(softenedMarketRealizationAmount(1_000, 0, 0, rt)).toBe(0);
  });

  it("is continuous across zero production", () => {
    // Mid-ramp, an epsilon of output and exactly zero output must agree.
    const epsilon = softenedMarketRealizationAmount(1_000, 1e-9, 0, rt / 2);
    const zero = softenedMarketRealizationAmount(1_000, 0, 0, rt / 2);
    expect(Math.abs(epsilon - zero)).toBeLessThan(1e-6);
    // …and the old behaviour (baseline substitution) is gone.
    expect(zero).toBeLessThan(1_000);
  });

  it("is still a no-op on the flip turn", () => {
    expect(softenedMarketRealizationAmount(1_000, 0, 100, 100)).toBe(1_000);
    expect(softenedMarketRealizationAmount(1_000, 9_999, 100, 100)).toBe(1_000);
  });

  it("still governs a halt mid-ramp rather than dropping it straight to zero", () => {
    const mid = softenedMarketRealizationAmount(1_000, 0, 0, rt / 2);
    expect(mid).toBeCloseTo(1_000 * (1 - MARKET_REALIZATION_DEVIATION_CAP), 6);
  });

  it("never returns a negative amount", () => {
    expect(softenedMarketRealizationAmount(1_000, -50, 0, rt)).toBe(0);
  });

  it("passes the market amount through when there is no baseline to govern", () => {
    expect(softenedMarketRealizationAmount(0, 700, 0, rt)).toBe(700);
    expect(softenedMarketRealizationAmount(Number.NaN, 700, 0, rt)).toBe(700);
    expect(softenedMarketRealizationAmount(0, 0, 0, rt)).toBe(0);
  });
});
