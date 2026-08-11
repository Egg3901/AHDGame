import { describe, it, expect } from "vitest";
import { legislationTypes } from "./legislationTypes";

/**
 * For these spending / social bills, the most-EXPANSIONARY option (highest
 * effectDirection — i.e. more spending / stronger intervention) must IMPROVE the
 * listed metric, since that is the bill's entire purpose. A metric improves at an
 * option when `effectDirection × weight > 0` (the good-intent sign; the runtime
 * applies the isHigherBetter polarity separately — see policyEffects.ts and
 * policyDirection.ts).
 *
 * Guards the DE/UK cluster that modeled welfare / jobs / skills / housing spending
 * as WORSENING poverty, unemployment, inequality, and homelessness (inverted
 * weight sign — the double-negative trap on lower-is-better metrics). Verified
 * against correct peers (us_minimum_wage poverty +0.5, jp_regional_economic_
 * development unemployment +1, ie_unemployment_benefits poverty +0.7, etc.).
 *
 * Curated rather than domain-wide on purpose: some negative weights are
 * deliberate trade-offs (crimeRate on justice bills, costOfLiving on stimulus,
 * contested immigration→unemployment) and must NOT be asserted here.
 */
const EXPECT_IMPROVES_AT_EXPANSION: { id: string; metric: string }[] = [
  // UK cluster
  { id: "uk_regional_economic_development", metric: "unemploymentRate" },
  { id: "uk_fiscal_spending", metric: "unemploymentRate" },
  { id: "uk_fiscal_spending", metric: "povertyRate" },
  { id: "uk_regional_skills", metric: "unemploymentRate" },
  { id: "uk_workforce_development", metric: "unemploymentRate" },
  { id: "uk_social_care", metric: "povertyRate" },
  { id: "uk_tuition_fees", metric: "incomeInequality" },
  // DE cluster
  { id: "de_unemployment_welfare", metric: "povertyRate" },
  { id: "de_unemployment_welfare", metric: "incomeInequality" },
  { id: "de_minimum_wage", metric: "povertyRate" },
  { id: "de_minimum_wage", metric: "incomeInequality" },
  { id: "de_pension_system", metric: "povertyRate" },
  { id: "de_health_insurance", metric: "povertyRate" },
  { id: "de_gender_equality", metric: "incomeInequality" },
  { id: "de_labor_reform", metric: "incomeInequality" },
  { id: "de_housing", metric: "homelessnessRate" },
  { id: "de_housing", metric: "incomeInequality" },
  { id: "de_fiscal_stimulus_act", metric: "unemploymentRate" },
];

describe("spending bills: expansion improves the target metric", () => {
  for (const { id, metric } of EXPECT_IMPROVES_AT_EXPANSION) {
    it(`${id}: most-expansionary option improves ${metric}`, () => {
      const lt = (legislationTypes as any[]).find((l) => l._id === id);
      expect(lt, `bill ${id} not found`).toBeTruthy();
      const target = (lt.effectTargetsWeighted ?? []).find((t: any) => t.metricId === metric);
      expect(target, `${id} has no ${metric} weighted target`).toBeTruthy();
      const opts = (lt.policyOptions ?? []).filter(
        (o: any) => typeof o.effectDirection === "number"
      );
      const expansion = opts.reduce((a: any, b: any) =>
        b.effectDirection > a.effectDirection ? b : a
      );
      // Good-intent sign: the metric improves at this option iff this is > 0.
      expect(expansion.effectDirection * target.weight).toBeGreaterThan(0);
    });
  }
});
