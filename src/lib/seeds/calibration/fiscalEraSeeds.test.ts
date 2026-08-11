/**
 * Fiscal-baseline calibration for pre-1991 era presets (audit finding F-03).
 *
 * Root cause of F-03: seed-time national spending is derived from the modern
 * legislation catalog via the LEGACY cost path (`deriveSpending` threads no era
 * year), whose GDP-indexed cost scale used to CLAMP at the 1991-calibrated
 * `scaleLow` floor. Charging modern-absolute per-capita law costs at the 1991
 * floor against 1953-era GDPs seeded UK spending at 1418% of GDP, IE at 2638%,
 * US at 149% — and `processTreasuryTurn` accrues that seeded deficit every turn
 * until the first fiscal-year recompute. The fix extrapolates the cost scale
 * proportionally below the 1991 anchor (a per-capita cost holds its 1991 SHARE
 * of the economy), leaving 1991+ eras byte-identical.
 *
 * These tests pin the seed-time spending/GDP (and revenue/GDP) bands so the
 * blowup cannot regress.
 */
import { describe, it, expect } from "vitest";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { getGdpIndexedCostScale, COST_SCALE_ANCHORS } from "@/lib/budget/costs";

function ratios(preset: string) {
  return getInitialNationalBudgetsForPreset(preset).map((b) => ({
    countryId: b.countryId,
    spendToGdp: b.spending.total / b.gdp,
    revenueToGdp: b.revenue.total / b.gdp,
  }));
}

describe("1953 seed fiscal baselines (F-03)", () => {
  const byId = Object.fromEntries(ratios("1953-default").map((r) => [r.countryId, r]));

  // Audit trio — the countries F-03 named. Plausible 1953 totals: US federal
  // outlays ~20% of GDP historically (Korean War), UK general-gov closer to
  // mid-30s; the band is deliberately loose around authored baselines.
  it.each(["US", "UK"] as const)(
    "%s seeds total spending between 10%% and 50%% of era GDP",
    (countryId) => {
      const r = byId[countryId];
      expect(r.spendToGdp).toBeGreaterThanOrEqual(0.1);
      expect(r.spendToGdp).toBeLessThanOrEqual(0.5);
    }
  );

  it("US/UK defense shares land in Cold War bands (not modern peacetime)", () => {
    const budgets = getInitialNationalBudgetsForPreset("1953-default");
    const us = budgets.find((b) => b.countryId === "US")!;
    const uk = budgets.find((b) => b.countryId === "UK")!;
    expect((us.spending.byCategory.defense ?? 0) / us.gdp).toBeGreaterThan(0.12);
    expect((uk.spending.byCategory.defense ?? 0) / uk.gdp).toBeGreaterThan(0.07);
  });

  // IE gets its own wider ceiling (not the 50% shared by US/UK): IE's headline
  // GDP is corrected (refs #3591) to remove ~2.3x multinational profit-shifting
  // inflation, which is real and well-documented (Ireland's GNI vs GDP gap) —
  // the same absolute spending now reads as a higher share of the smaller,
  // more accurate GDP figure. ~52% is that correction surfacing, not a F-03-style
  // blowup (which was 2638%).
  it("IE seeds total spending between 10% and 55% of era GDP", () => {
    const r = byId.IE;
    expect(r.spendToGdp).toBeGreaterThanOrEqual(0.1);
    expect(r.spendToGdp).toBeLessThanOrEqual(0.55);
  });

  // The other policy-catalog countries that blew up pre-fix (DE 273%, JP 978%,
  // CN 236%). Wider band: CN seeds lean when only defense/health are baseline-
  // pinned (other categories stay on the GDP-indexed modern ladder).
  it.each(["DE", "JP", "CN"] as const)(
    "%s seeds total spending between 5%% and 50%% of era GDP",
    (countryId) => {
      const r = byId[countryId];
      expect(r.spendToGdp).toBeGreaterThanOrEqual(0.05);
      expect(r.spendToGdp).toBeLessThanOrEqual(0.5);
    }
  );

  it("no 1953 country seeds spending above 120% of GDP (command-economy baselines are authored high)", () => {
    // Authored command-economy baselines (RU/DD/HU/bloc) intentionally sit at
    // 79-92% of NMP-style GDP; the guard only catches the F-03 blowup class.
    for (const r of ratios("1953-default")) {
      expect(r.spendToGdp, `${r.countryId} spend/GDP`).toBeLessThanOrEqual(1.2);
    }
  });

  it("UK 1953 revenue stays below 60% of GDP (era-scaled NHS income ladder)", () => {
    // The modern uk_nhs_funding revenue ladder (200 £/capita at the default
    // option) booked £10.1B healthcareIncome = 70% of the £14.4B 1953 GDP,
    // pushing seeded revenue to 103.6% of GDP. The 1953 config now carries an
    // era-scaled ladder.
    expect(byId.UK.revenueToGdp).toBeLessThanOrEqual(0.6);
    expect(byId.UK.revenueToGdp).toBeGreaterThanOrEqual(0.15);
  });
});

describe("1979 seed fiscal baselines (F-03 pre-1991 scope)", () => {
  it("no 1979 country seeds spending above 120% of GDP", () => {
    // Pre-fix: NG 544%, IE 115% of GDP.
    for (const r of ratios("1979-default")) {
      expect(r.spendToGdp, `${r.countryId} spend/GDP`).toBeLessThanOrEqual(1.2);
    }
  });

  it.each(["US", "UK"] as const)("%s seeds spending within 10-50%% of GDP", (countryId) => {
    const r = ratios("1979-default").find((x) => x.countryId === countryId)!;
    expect(r.spendToGdp).toBeGreaterThanOrEqual(0.1);
    expect(r.spendToGdp).toBeLessThanOrEqual(0.5);
  });

  // See the 1953 block above for why IE gets a wider ceiling than US/UK.
  it("IE seeds spending within 10-55% of GDP", () => {
    const r = ratios("1979-default").find((x) => x.countryId === "IE")!;
    expect(r.spendToGdp).toBeGreaterThanOrEqual(0.1);
    expect(r.spendToGdp).toBeLessThanOrEqual(0.55);
  });
});

describe("1991+ eras unchanged by the F-03 scale fix", () => {
  it("the cost scale still equals scaleLow exactly at each 1991 anchor (continuity)", () => {
    // The sub-anchor extrapolation and the legacy ramp agree at gpc == gpcLow,
    // so 1991-era seeds (whose gdp/pop ARE the anchors, enforced by
    // anchorConsistency.test.ts) are byte-identical to pre-fix output.
    for (const [countryId, anchor] of Object.entries(COST_SCALE_ANCHORS)) {
      const gpcLow = anchor.gdpLow / anchor.popLow;
      expect(getGdpIndexedCostScale(countryId, gpcLow)).toBeCloseTo(anchor.scaleLow, 12);
    }
  });

  it("1991 seed spending/GDP stays in the pre-fix sane band", () => {
    for (const r of ratios("1991-default")) {
      expect(r.spendToGdp, `${r.countryId} spend/GDP`).toBeGreaterThanOrEqual(0.05);
      expect(r.spendToGdp, `${r.countryId} spend/GDP`).toBeLessThanOrEqual(0.6);
    }
  });
});
