import { describe, expect, it } from "vitest";
import {
  LEGISLATION_COST_CLASS,
  getCostClass,
  resolveEraSpendingCost,
} from "./legislationCostCatalog";

// Seed two synthetic ids so the two forms are testable before the real table
// (Task 3) is authored.
LEGISLATION_COST_CLASS.x_gdp = "gdpFraction";
LEGISLATION_COST_CLASS.x_pc = "perCapita";

describe("era cost forms", () => {
  const ctx = { countryId: "US", year: 2019, gdp: 20_000_000, population: 100 };

  it("gdpFraction: cost = gdpCostFraction × GDP", () => {
    const cost = resolveEraSpendingCost("x_gdp", { gdpCostFraction: 0.03 }, ctx);
    expect(cost).toBeCloseTo(0.03 * 20_000_000);
  });

  it("perCapita: cost pins to the calibrated share of GDP, not the live income base (#3149)", () => {
    // frac was materialized as share / i2g, so the resolved charge is
    // frac × i2g × gdp === share × gdp regardless of the live median income. The
    // live income no longer scales the charge (it is symmetrically clamped to the
    // calibrated income-to-GDP ratio — see the #3000 ceiling / #3149 floor).
    const i2gUS = (65_000 * 333_000_000) / 27_000_000_000_000;
    const withIncome = resolveEraSpendingCost(
      "x_pc",
      { incomeCostFraction: 0.02 },
      { ...ctx, nationalMedianIncome: 40_000 }
    );
    expect(withIncome).toBeCloseTo(0.02 * i2gUS * 20_000_000);
    // The retired income-scaling form (fraction × income × population) is gone.
    expect(withIncome).not.toBeCloseTo(0.02 * 40_000 * 100);
  });

  it("perCapita: a low live income (below the calibration anchor) no longer suppresses spending (#3149)", () => {
    // JP-shaped pathology: live medianIncome sits at ~0.36× the calibration income
    // anchor, which used to scale EVERY perCapita law down to ~0.36× its intended
    // %GDP. The charge must now be identical whether income is low, at anchor, or
    // absent — all land on the calibrated share of GDP.
    const jp = { countryId: "JP", year: 2019, gdp: 550_000_000_000_000, population: 126_000_000 };
    const suppressedLow = resolveEraSpendingCost(
      "x_pc",
      { incomeCostFraction: 0.02 },
      { ...jp, nationalMedianIncome: 2_090_000 } // ~0.36× the ¥5.5M anchor
    );
    const atAnchor = resolveEraSpendingCost(
      "x_pc",
      { incomeCostFraction: 0.02 },
      { ...jp, nationalMedianIncome: 5_500_000 }
    );
    const noIncome = resolveEraSpendingCost("x_pc", { incomeCostFraction: 0.02 }, jp);
    // incomeCostFraction is explicitly provided above, so these are never
    // undefined at runtime — non-null asserted only to satisfy the (correct)
    // `number | undefined` return type toBeCloseTo doesn't accept.
    expect(suppressedLow).toBeCloseTo(atAnchor!);
    expect(suppressedLow).toBeCloseTo(noIncome!);
    // Concretely: the old code returned frac × income × pop for the low case, ~0.36×
    // the calibrated share. The fix must be ~2.8× that suppressed value.
    const oldSuppressed = 0.02 * 2_090_000 * 126_000_000;
    expect(suppressedLow).toBeGreaterThan(oldSuppressed * 2);
  });

  it("perCapita without game income: share-of-GDP fallback via incomeToGdp, never the era anchor", () => {
    const cost = resolveEraSpendingCost("x_pc", { incomeCostFraction: 0.02 }, ctx);
    // incomeToGdp(US) = incomeAnchor(US, 2019) × 333M / $27T (REP_ECON) — the
    // calibration-time ratio, so the fallback lands on the intended %GDP share.
    const i2gUS = (65_000 * 333_000_000) / 27_000_000_000_000;
    expect(cost).toBeCloseTo(0.02 * i2gUS * 20_000_000);
    // The retired charge-time form (fraction × anchor × population) must be gone:
    expect(cost).not.toBeCloseTo(0.02 * 65_000 * 100);
  });

  it("perCapita caps at the calibrated share-of-GDP when live income exceeds it (CN-class seed, #3000)", () => {
    // Under-grown seed economy: CN GDP/capita ≈ ¥2.4k but the income metric never
    // grew down from the real-world ¥67.6k — 28× GDP/capita. The cap must collapse
    // the charge to the same share-of-GDP the no-income fallback produces.
    const cnCtx = { countryId: "CN", year: 2011, gdp: 2_843_000, population: 1207 };
    const capped = resolveEraSpendingCost(
      "x_pc",
      { incomeCostFraction: 0.02 },
      { ...cnCtx, nationalMedianIncome: 67_649 }
    );
    const fallback = resolveEraSpendingCost("x_pc", { incomeCostFraction: 0.02 }, cnCtx);
    expect(capped).toBeCloseTo(fallback!); // capped === frac × i2g × gdp (share-of-GDP)
    // and far below the uncapped charge that produced the 204%-of-GDP phantom deficit
    expect(capped).toBeLessThan((0.02 * 67_649 * 1207) / 10);
  });

  it("none / missing fields ⇒ 0 (no phantom cost)", () => {
    expect(resolveEraSpendingCost("x_none", {}, ctx)).toBe(0);
  });

  // Fiscal-scale audit (2026-07-28): a law whose TYPE is classed here
  // (gdpFraction/perCapita) but whose own document was never migrated onto the
  // era catalog — it still carries a legacy `gdpPerCapitaMultiplier` /
  // `annualCostPerCapita` and no `gdpCostFraction`/`incomeCostFraction` — must
  // defer to that legacy field rather than resolve to a phantom `0`. Before this
  // fix, `?? 0` made a classed-but-unmigrated law price at exactly 0 forever
  // (jp_national_health_insurance, jp_article9_sdf, ie_healthcare_policy,
  // ie_defence_spending, cn_medical_insurance, cn_pla_modernization,
  // ng_health_insurance, ng_defense_policy and siblings all reproduced this).
  it("gdpFraction: missing gdpCostFraction on a classed-but-unmigrated law ⇒ undefined (defer to legacy fields)", () => {
    expect(resolveEraSpendingCost("x_gdp", {}, ctx)).toBeUndefined();
  });

  it("perCapita: missing incomeCostFraction on a classed-but-unmigrated law ⇒ undefined (defer to legacy fields)", () => {
    expect(resolveEraSpendingCost("x_pc", {}, ctx)).toBeUndefined();
  });

  it("a genuinely materialized zero is still honoured as 0, not deferred", () => {
    expect(resolveEraSpendingCost("x_gdp", { gdpCostFraction: 0 }, ctx)).toBe(0);
    expect(resolveEraSpendingCost("x_pc", { incomeCostFraction: 0 }, ctx)).toBe(0);
  });

  it("unknown typeId ⇒ none class", () => {
    expect(getCostClass("totally_unknown")).toBe("none");
  });
});
