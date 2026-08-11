/**
 * Unified policy-option builders for legislation seed data.
 *
 * Replaces the per-country helper trees:
 *   - US/UK: policyOptions() (single-axis), policyOptionsBoth() (both axes)
 *   - JP: policyOptionsJP()
 *   - US/UK/JP/IE/CN: taxRateOptionsV3() / taxRateOptions() / taxRateOptionsIE() / taxRateOptionsCN()
 *   - US/UK: withPerCapitaCosts(); JP: withPerCapitaCostsJPY()
 *
 * Convention notes
 * ----------------
 * Non-tax `policyOptions` uses the US/UK convention:
 *   left  → effectDirection +1 (intervention / expansion)
 *   right → effectDirection -1 (cutback / market)
 *   center → effectDirection  0
 *
 * Tax `taxRateOptions` uses the INVERTED convention (domain-specific):
 *   left  → effectDirection -1 (high rate = revenue extraction; hurts gdpGrowth)
 *   right → effectDirection +1 (low rate = market-friendly)
 *
 * Together with `effectTargetsWeighted` weights (always magnitude; runtime applies
 * isHigherBetter polarity), these conventions produce correct contribution signs
 * for primary metrics under the engine in `src/lib/policyEffects.ts`.
 *
 * Currency on costs lives in `CountryConfig.currency`, not in the helper — there
 * is no JPY-specific helper. Pass local-currency amounts to `withPerCapitaCosts`.
 */

import type { LegislationPolicyOption } from "@/lib/db/types/legislation";
import { optionIntensity } from "@/lib/legislature/optionIntensity";

export type AxisMode = "both" | "economic" | "social";

export interface PolicyOptionInput {
  name: string;
  /** Per-option flavor copy. Often supplied via a later `.map()` chain with an array. */
  explanation?: string;
  stance: "left" | "center" | "right";
  /**
   * Optional. Defaults to stance-derived per the non-tax convention
   * (left=+1, center=0, right=-1). Override only when content semantics require it.
   */
  effectDirection?: -1 | 0 | 1;
  /** Per-option economic-axis score override (-5..+5). Auto-derived from stance if absent. */
  economic?: number;
  /** Per-option social-axis score override (-5..+5). Auto-derived from stance if absent. */
  social?: number;
  /** Pass-through to LegislationPolicyOption. */
  archetypeApprovals?: Record<string, number>;
  /** Pass-through for minimum-wage types. */
  minimumWageRate?: number;
}

export interface TaxRateOptionInput {
  rate: number;
  name: string;
  description: string;
  stance: "left" | "center" | "right";
  economic: number;
  social: number;
}

/**
 * Score for any single stance×position from a left/center/right option set.
 * Left options span -5..-1 (linear), right options span +1..+5, center is 0.
 * A single left or right option lands at -3 / +3 respectively.
 */
function deriveStanceScore(
  stance: "left" | "center" | "right",
  position: number,
  total: number
): number {
  if (stance === "center") return 0;
  if (stance === "left") {
    if (total <= 1) return -3;
    return Math.max(-5, Math.min(5, Math.round(-5 + (position / Math.max(1, total - 1)) * 4)));
  }
  if (total <= 1) return 3;
  return Math.max(-5, Math.min(5, Math.round(1 + (position / Math.max(1, total - 1)) * 4)));
}

/**
 * Build LegislationPolicyOption records from a stance-graded option set.
 *
 * @param typeId  Used to generate option ids: `${typeId}_opt_${i}`.
 * @param opts    Ordered option set (left first → right last).
 * @param axes    Which axis (or both) gets the derived stance score. Required —
 *                explicit at every call site so the score axis is unambiguous.
 *                Use `"economic"` for tax / fiscal / labor types, `"social"`
 *                for cultural / civil-liberties types, `"both"` for welfare /
 *                housing / health types where left-right alignment is felt on
 *                both axes. The non-derived axis is 0 unless the caller
 *                overrides per-option.
 */
export function policyOptions(
  typeId: string,
  opts: PolicyOptionInput[],
  axes: AxisMode
): LegislationPolicyOption[] {
  const lefts = opts.filter((x) => x.stance === "left");
  const rights = opts.filter((x) => x.stance === "right");

  return opts.map((o, i) => {
    const computed =
      o.stance === "left"
        ? deriveStanceScore("left", lefts.indexOf(o), lefts.length)
        : o.stance === "right"
          ? deriveStanceScore("right", rights.indexOf(o), rights.length)
          : 0;

    const economic = o.economic ?? (axes === "social" ? 0 : computed);
    const social = o.social ?? (axes === "economic" ? 0 : computed);

    const effectDirection: -1 | 0 | 1 =
      o.effectDirection ?? (o.stance === "left" ? 1 : o.stance === "right" ? -1 : 0);

    return {
      id: `${typeId}_opt_${i}`,
      name: o.name,
      ...(o.explanation !== undefined ? { explanation: o.explanation } : {}),
      stance: o.stance,
      effectDirection,
      economic,
      social,
      ...(o.archetypeApprovals !== undefined ? { archetypeApprovals: o.archetypeApprovals } : {}),
      ...(o.minimumWageRate !== undefined ? { minimumWageRate: o.minimumWageRate } : {}),
    };
  });
}

/**
 * Peak per-turn small-business-formation tick for the MOST extreme tax bracket:
 * lower-tax (right) options lift business formation, higher-tax (left) options
 * dampen it. This is the right-option upside (P6c symmetry) — a tax cut now
 * improves a natural economic metric, not merely the budget line. Scaled by the
 * option's graded intensity so a moderate cut ticks less than a maximum one
 * (Bug #0962: the flat ±value was the sole non-monotone metric on tax laws).
 */
export const TAX_SMALL_BUSINESS_UPSIDE = 0.05;

/**
 * Build LegislationPolicyOption records for tax-rate brackets.
 *
 * The display name is the rate (e.g., `"23%"`); the explanation is built from
 * `${name}: ${description}`. Uses the inverted tax convention for effectDirection.
 */
export function taxRateOptions(
  typeId: string,
  brackets: TaxRateOptionInput[]
): LegislationPolicyOption[] {
  // Graded intensity per bracket (same helper the sim/display use), so the
  // small-business tick scales with how far the bracket sits from the centre.
  const ladder = brackets.map((b) => ({
    effectDirection: (b.stance === "left" ? -1 : b.stance === "right" ? 1 : 0) as -1 | 0 | 1,
  }));
  return brackets.map((b, i) => {
    const effectDirection = ladder[i].effectDirection;
    const intensity = optionIntensity(ladder, i); // −1..+1
    return {
      id: `${typeId}_opt_${i}`,
      name: `${b.rate}%`,
      explanation: `${b.name}: ${b.description}`,
      stance: b.stance,
      effectDirection,
      economic: b.economic,
      social: b.social,
      rate: b.rate,
      metricEffects:
        effectDirection === 0
          ? []
          : [
              {
                category: "economic" as const,
                metricId: "smallBusinessFormation",
                // effectDirection +1 (right/low tax) ⇒ positive intensity ⇒ upside.
                ratePerTurn: intensity * TAX_SMALL_BUSINESS_UPSIDE,
              },
            ],
    };
  });
}

/**
 * Annotate option set with per-capita cost in local currency units. Currency
 * code lives in `CountryConfig.currency`; this helper is currency-neutral.
 */
export function withPerCapitaCosts(
  options: LegislationPolicyOption[],
  annualCostPerCapita: number[]
): LegislationPolicyOption[] {
  return options.map((option, index) => ({
    ...option,
    ...(annualCostPerCapita[index] !== undefined && {
      annualCostPerCapita: annualCostPerCapita[index],
    }),
  }));
}

/**
 * Annotate option set with cost as a fraction of GDP (`gdpPerCapitaMultiplier`
 * — the legacy field name predates this GDP-fraction usage, but per
 * `calculatePolicyOptionAnnualCost`/`calculateEnactedLawAnnualCost` it is
 * applied as `multiplier * gdp`, no population term, no country-anchor
 * scale-ramp). Mirrors the CN/JP/DE 1953 spending-calibration pattern
 * (fiscal-scale audit, 2026-07-28): a fraction authored directly off a
 * `baselineSpendingByCategory` amount / gdp ratio reconciles exactly, and
 * — unlike `annualCostPerCapita` — is immune to a future `COST_SCALE_ANCHORS`
 * entry silently rescaling it.
 */
export function withGdpFractionCosts(
  options: LegislationPolicyOption[],
  gdpFraction: number[]
): LegislationPolicyOption[] {
  return options.map((option, index) => ({
    ...option,
    ...(gdpFraction[index] !== undefined && {
      gdpPerCapitaMultiplier: gdpFraction[index],
    }),
  }));
}
