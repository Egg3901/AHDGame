import { describe, it, expect } from "vitest";
import {
  advanceRevenueEma,
  computeConsumptionTaxAdjustedGrowthRate,
  computeRealizedRevenueGrowthRate,
  computeTrailingRevenueGrowthRate,
  computeWeightedGrowthRate,
  selectRevenueTrendBaseline,
  sumHostRealizedRevenue,
  sumRealizedRevenue,
  updateRevenueSnapshots,
  REVENUE_EMA_ALPHA,
  REVENUE_SNAPSHOT_EVERY,
  REVENUE_SNAPSHOT_KEEP,
  REVENUE_TREND_MIN_SPAN,
  SECTOR_SIGNAL_MAX,
  SECTOR_SIGNAL_MIN,
} from "./gdpGrowth";

// The gdpGrowth turn PHASE was ported into the metric engine (P0); its phase-level
// behavior is covered by the golden-master parity tests in
// `src/lib/metricEngine/phase.test.ts`. These tests cover the surviving pure helpers.

// ── computeWeightedGrowthRate ─────────────────────────────────────────────────

describe("computeWeightedGrowthRate", () => {
  it("returns DEFAULT_UNOWNED_GROWTH_RATE (0.5%) when no sectors exist", () => {
    expect(computeWeightedGrowthRate([], [])).toBe(0.5);
  });

  it("returns currentGrowthRate for single owned sector", () => {
    const owned = [{ revenue: 1000, currentGrowthRate: 2.5 }];
    expect(computeWeightedGrowthRate(owned, [])).toBe(2.5);
  });

  it("defaults unowned sectors to 0.5% background growth", () => {
    const unowned = [{ revenue: 1000 }];
    expect(computeWeightedGrowthRate([], unowned)).toBe(0.5);
  });

  it("weights by revenue when multiple owned sectors", () => {
    // Sector A: 1000 revenue @ 2% = 2000 weighted
    // Sector B: 3000 revenue @ 4% = 12000 weighted
    // Total: 4000 revenue, 14000 weighted → 3.5%
    const owned = [
      { revenue: 1000, currentGrowthRate: 2 },
      { revenue: 3000, currentGrowthRate: 4 },
    ];
    expect(computeWeightedGrowthRate(owned, [])).toBe(3.5);
  });

  it("weights owned and unowned together", () => {
    // Owned: 2000 revenue @ 3% = 6000 weighted
    // Unowned: 2000 revenue @ 0.5% = 1000 weighted
    // Total: 4000 revenue, 7000 weighted → 1.75%
    const owned = [{ revenue: 2000, currentGrowthRate: 3 }];
    const unowned = [{ revenue: 2000 }];
    expect(computeWeightedGrowthRate(owned, unowned)).toBe(1.75);
  });

  it("handles mixed owned and unowned with different revenue weights", () => {
    const owned = [
      { revenue: 1000, currentGrowthRate: 0 },
      { revenue: 1000, currentGrowthRate: 2 },
    ];
    const unowned = [{ revenue: 8000 }];
    expect(computeWeightedGrowthRate(owned, unowned)).toBe(0.6);
  });

  it("rounds appropriately with floating point revenues", () => {
    const owned = [{ revenue: 333333.33, currentGrowthRate: 1.5 }];
    const unowned = [{ revenue: 666666.67 }];
    const result = computeWeightedGrowthRate(owned, unowned);
    expect(result).toBeCloseTo(0.833, 2);
  });
});

// ── computeConsumptionTaxAdjustedGrowthRate ─────────────────────────

describe("computeConsumptionTaxAdjustedGrowthRate", () => {
  it("applies demand drag when US federal sales tax rises above the 0% baseline", () => {
    expect(computeConsumptionTaxAdjustedGrowthRate(2, 10, 6, "US")).toBe(1.5);
  });

  it("does not penalize the seeded UK VAT baseline", () => {
    expect(computeConsumptionTaxAdjustedGrowthRate(2, 20, 0, "UK")).toBe(2);
  });

  it("credits VAT cuts below a country's seeded baseline", () => {
    expect(computeConsumptionTaxAdjustedGrowthRate(2, 16, 0, "UK")).toBe(2.2);
  });

  it("treats countries without seeded national VAT rates as neutral at 0%", () => {
    expect(computeConsumptionTaxAdjustedGrowthRate(2, 0, 0, "IE")).toBe(2);
  });
});

// ── P2/D7: plants-mode realized-revenue signal ──────────────────────

describe("computeRealizedRevenueGrowthRate (plants mode)", () => {
  it("annualizes a one-turn realized-revenue delta over the 48-turn year", () => {
    // +0.1% in one turn → 0.1 × 48 = 4.8%/yr
    expect(computeRealizedRevenueGrowthRate(1001, 1000, 1, 48)).toBeCloseTo(4.8, 10);
  });

  it("divides by the turn gap when the baseline is several turns old", () => {
    // +1% over 4 turns → 1 × (48/4) = 12%/yr
    expect(computeRealizedRevenueGrowthRate(1010, 1000, 4, 48)).toBeCloseTo(12, 10);
  });

  it("is negative when realized revenue contracts", () => {
    // −0.5% over 4 turns → −6%/yr, inside the floor
    expect(computeRealizedRevenueGrowthRate(995, 1000, 4, 48)).toBeCloseTo(-6, 10);
  });

  it("clamps an explosive delta to the sector-signal ceiling before the EMA", () => {
    expect(computeRealizedRevenueGrowthRate(2000, 1000, 1, 48)).toBe(SECTOR_SIGNAL_MAX);
  });

  it("clamps a collapse to the sector-signal floor before the EMA", () => {
    expect(computeRealizedRevenueGrowthRate(1, 1000, 1, 48)).toBe(SECTOR_SIGNAL_MIN);
  });

  it("returns null (→ caller falls back) with no usable baseline", () => {
    expect(computeRealizedRevenueGrowthRate(1000, undefined, 1, 48)).toBeNull();
    expect(computeRealizedRevenueGrowthRate(1000, 0, 1, 48)).toBeNull();
    expect(computeRealizedRevenueGrowthRate(1000, -5, 1, 48)).toBeNull();
    expect(computeRealizedRevenueGrowthRate(1000, NaN, 1, 48)).toBeNull();
  });

  it("returns null for a non-positive or missing turn gap (same-turn re-run)", () => {
    expect(computeRealizedRevenueGrowthRate(1000, 900, 0, 48)).toBeNull();
    expect(computeRealizedRevenueGrowthRate(1000, 900, -3, 48)).toBeNull();
    expect(computeRealizedRevenueGrowthRate(1000, 900, undefined, 48)).toBeNull();
  });

  it("treats a zero-revenue region as a real (clamped) collapse, not a fallback", () => {
    expect(computeRealizedRevenueGrowthRate(0, 1000, 1, 48)).toBe(SECTOR_SIGNAL_MIN);
  });
});

describe("sumRealizedRevenue", () => {
  it("sums owned-sector revenue and ignores non-finite entries", () => {
    expect(sumRealizedRevenue([{ revenue: 100 }, { revenue: 250 }], true)).toBe(350);
    expect(sumRealizedRevenue([{ revenue: 100 }, { revenue: NaN }], true)).toBe(100);
    expect(sumRealizedRevenue([], true)).toBe(0);
  });

  // The name always promised realized revenue; the implementation summed
  // nominal. Under plants `revenue` is the capacity NAMEPLATE and capacity only
  // depreciates, so both the signal and the persisted baseline fell every turn
  // regardless of what sectors actually earned — a permanent phantom recession.
  it("prefers realizedRevenue over the nominal nameplate under plants", () => {
    expect(
      sumRealizedRevenue(
        [
          { revenue: 1000, realizedRevenue: 600 },
          { revenue: 500, realizedRevenue: 450 },
        ],
        true
      )
    ).toBe(1050);
  });

  it("falls back to revenue per-sector when realizedRevenue is absent or garbage", () => {
    expect(
      sumRealizedRevenue(
        [
          { revenue: 1000, realizedRevenue: 600 },
          { revenue: 500 },
          { revenue: 200, realizedRevenue: NaN },
        ],
        true
      )
    ).toBe(1300);
  });

  // A sector that genuinely realized nothing must contribute 0, not silently
  // fall back to its nameplate — otherwise a total production halt is invisible.
  it("treats a realized zero as real, not as a missing value", () => {
    expect(sumRealizedRevenue([{ revenue: 1000, realizedRevenue: 0 }], true)).toBe(0);
  });

  // BELOW-PLANTS BYTE-IDENTITY PIN. The sector turn writes `realizedRevenue` in
  // EVERY mode, so an ungated preference silently moved state GDP and the
  // persisted `sectorRealizedRevenue` baseline from nameplate to realized on
  // every capital-mode and legacy-mode world. Below plants the sum must be the
  // plain nameplate sum, whatever realizedRevenue happens to say.
  it("ignores realizedRevenue entirely below plants", () => {
    const sectors = [
      { revenue: 1000, realizedRevenue: 600 },
      { revenue: 500, realizedRevenue: 450 },
      { revenue: 200, realizedRevenue: 0 },
    ];
    expect(sumRealizedRevenue(sectors, false)).toBe(1700);
  });

  it("below plants is unaffected by a realized zero", () => {
    expect(sumRealizedRevenue([{ revenue: 1000, realizedRevenue: 0 }], false)).toBe(1000);
  });
});

describe("sumHostRealizedRevenue (plants GDP signal, ticket #1084)", () => {
  it("prefers host realized over host nameplate", () => {
    expect(
      sumHostRealizedRevenue([
        { hostRevenue: 1000, hostRealizedRevenue: 600 },
        { hostRevenue: 500, hostRealizedRevenue: 450 },
      ])
    ).toBe(1050);
  });

  it("falls back to host nameplate when realized is missing", () => {
    expect(sumHostRealizedRevenue([{ hostRevenue: 1000 }, { hostRevenue: 500 }])).toBe(1500);
  });

  it("treats a realized zero as real", () => {
    expect(sumHostRealizedRevenue([{ hostRevenue: 1000, hostRealizedRevenue: 0 }])).toBe(0);
  });
});

describe("computeRealizedRevenueGrowthRate FX contamination (ticket #1084)", () => {
  it("a ~0.2% FX-only ₳ restatement annualizes to a several-point GDP jig", () => {
    const local = 1000;
    const prevAnchor = local / 0.8;
    const nowAnchor = local / 0.8016;
    // (0.8/0.8016 − 1) × 100 × 48 ≈ −9.58pp of phantom growth (inside the ±10/15 clamp)
    expect(computeRealizedRevenueGrowthRate(nowAnchor, prevAnchor, 1, 48)).toBeCloseTo(-9.58, 1);
  });

  it("the same local revenue compared host-to-host is zero growth", () => {
    expect(computeRealizedRevenueGrowthRate(1000, 1000, 1, 48)).toBe(0);
  });
});

// ── Trailing revenue trend (one-turn amplifier fix) ───────────────────────────

describe("advanceRevenueEma", () => {
  it("seeds at the level when no prior EMA exists", () => {
    expect(advanceRevenueEma(undefined, 1000)).toBe(1000);
    expect(advanceRevenueEma(0, 1000)).toBe(1000);
  });

  it("moves REVENUE_EMA_ALPHA of the way toward the new level", () => {
    expect(advanceRevenueEma(1000, 2000)).toBeCloseTo(1000 + REVENUE_EMA_ALPHA * 1000, 10);
  });

  it("holds the EMA on a garbage level", () => {
    expect(advanceRevenueEma(1000, NaN)).toBe(1000);
    expect(advanceRevenueEma(1000, -5)).toBe(1000);
  });

  it("attenuates one-turn churn instead of passing it through", () => {
    // A ±10% level wobble moves the EMA by ±1.5%, not ±10%.
    const ema = advanceRevenueEma(1000, 1100);
    expect(ema).toBeCloseTo(1015, 10);
  });
});

describe("updateRevenueSnapshots", () => {
  it("logs the first snapshot immediately", () => {
    expect(updateRevenueSnapshots(undefined, 100, 1000)).toEqual([{ turn: 100, value: 1000 }]);
  });

  it("skips while the newest entry is younger than the cadence", () => {
    const log = [{ turn: 100, value: 1000 }];
    expect(updateRevenueSnapshots(log, 100 + REVENUE_SNAPSHOT_EVERY - 1, 1100)).toEqual(log);
  });

  it("appends at the cadence and trims to the retention cap", () => {
    let log: { turn: number; value: number }[] = [];
    for (let t = 0; t <= REVENUE_SNAPSHOT_EVERY * 12; t++) {
      log = updateRevenueSnapshots(log, t, 1000 + t);
    }
    expect(log.length).toBe(REVENUE_SNAPSHOT_KEEP);
    expect(log[log.length - 1]!.turn).toBe(REVENUE_SNAPSHOT_EVERY * 12);
  });

  it("drops future-turn entries (a rolled-back world cannot poison the baseline)", () => {
    const log = [{ turn: 200, value: 1000 }];
    expect(updateRevenueSnapshots(log, 150, 900)).toEqual([{ turn: 150, value: 900 }]);
  });
});

describe("selectRevenueTrendBaseline", () => {
  it("returns null while every snapshot is younger than the minimum span", () => {
    const log = [{ turn: 100, value: 1000 }];
    expect(selectRevenueTrendBaseline(log, 100 + REVENUE_TREND_MIN_SPAN - 1)).toBeNull();
  });

  it("prefers the snapshot closest to the one-year target span", () => {
    const log = [
      { turn: 40, value: 900 }, // span 56
      { turn: 48, value: 950 }, // span 48 ← target
      { turn: 80, value: 990 }, // span 16
    ];
    expect(selectRevenueTrendBaseline(log, 96)).toEqual({ value: 950, spanTurns: 48 });
  });

  it("skips non-positive baselines", () => {
    const log = [{ turn: 0, value: 0 }];
    expect(selectRevenueTrendBaseline(log, 48)).toBeNull();
  });
});

describe("computeTrailingRevenueGrowthRate", () => {
  it("annualizes growth over the baseline span", () => {
    // +10% over 48 turns (one year) = 10% annualized.
    const out = computeTrailingRevenueGrowthRate(1100, { value: 1000, spanTurns: 48 }, 48);
    expect(out).toBeCloseTo(10, 10);
  });

  it("clamps to the shared signal bounds", () => {
    expect(computeTrailingRevenueGrowthRate(3000, { value: 1000, spanTurns: 48 }, 48)).toBe(
      SECTOR_SIGNAL_MAX
    );
    expect(computeTrailingRevenueGrowthRate(100, { value: 1000, spanTurns: 48 }, 48)).toBe(
      SECTOR_SIGNAL_MIN
    );
  });

  it("returns null without a usable baseline or EMA", () => {
    expect(
      computeTrailingRevenueGrowthRate(undefined, { value: 1000, spanTurns: 48 }, 48)
    ).toBeNull();
    expect(computeTrailingRevenueGrowthRate(1100, null, 48)).toBeNull();
    expect(computeTrailingRevenueGrowthRate(1100, { value: 0, spanTurns: 48 }, 48)).toBeNull();
  });

  it("a one-turn ±10% churn stays inside single digits instead of ±480", () => {
    // Level noise hits one endpoint attenuated by the EMA; over a year span it
    // annualizes by 1, not 48. EMA endpoint moved by alpha·10%:
    const emaNow = advanceRevenueEma(1000, 1100); // 1015
    const out = computeTrailingRevenueGrowthRate(emaNow, { value: 1000, spanTurns: 48 }, 48);
    expect(Math.abs(out!)).toBeLessThan(2);
  });
});
