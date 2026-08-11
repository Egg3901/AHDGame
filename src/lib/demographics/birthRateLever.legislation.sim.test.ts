import { describe, expect, it } from "vitest";
import { computeTickRates, type ActivePolicy } from "@/lib/policyEffects";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { getFederalMultiplier } from "@shared/constants/formulas";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * Birthrate lever strength — the natalist laws after region division.
 *
 * birthRate is an intensive 0-100 index with no metric-engine registry node, so the
 * ONLY thing that moves it is the additive `ratePerTurn` tick from an active policy's
 * metricEffects (computeTickRates). National policies are divided across regions
 * (getFederalMultiplier — UK 1/12, US 1/50), which is correct for EXTENSIVE totals but
 * dilutes an intensive index. With the shared TICK_RATES_7[0]=0.06 the strongest option
 * moved each region only 0.06 × 1/12 × 48 ≈ 0.24 (UK) / 0.06 × 1/50 × 48 ≈ 0.058 (US)
 * index/yr — imperceptible (the live player report: "1-2 game years and the birth rate
 * hasn't changed"). The dedicated *_BIRTH_RATE_TICK_RATES_7 arrays restore a noticeable
 * nudge that lands the SAME per-region rate regardless of region count.
 */
const legTypeMap = new Map(legislationTypes.map((l) => [l._id, l]));

function strongestBirthRateTickPerYear(legislationTypeId: string, country: string): number {
  const policy = {
    legislationTypeId,
    policyOptionId: `${legislationTypeId}__unmatched`, // forces the effectDirection fallback
    effectDirection: 1, // strongest left option (most generous family-support)
    scopeMultiplier: getFederalMultiplier(country), // divided across regions
  } as unknown as ActivePolicy;
  const rates = computeTickRates([policy], legTypeMap);
  return (rates.population?.birthRate ?? 0) * TURNS_PER_YEAR;
}

describe.each([
  { law: "uk_childcare", country: "UK" },
  { law: "us_paid_family_leave", country: "US" },
])("birthRate lever — $law after the $country region division", ({ law, country }) => {
  it(`${law} targets birthRate`, () => {
    const lt = legTypeMap.get(law);
    expect(lt, `${law} present`).toBeTruthy();
    const opt = lt?.policyOptions?.find((o) => o.effectDirection === 1);
    expect(
      opt?.metricEffects?.some((e) => e.metricId === "birthRate"),
      "strongest option moves birthRate"
    ).toBe(true);
  });

  it("the strongest option moves each region's birthRate a noticeable amount per year", () => {
    const perYear = strongestBirthRateTickPerYear(law, country);
    // ≥ 2 index points/year/region so the lever produces a visible demographic
    // response within ~1-2 game years instead of the old ~0.24/yr (UK) / 0.06/yr (US).
    expect(perYear, `birthRate Δ/yr = ${perYear.toFixed(3)}`).toBeGreaterThanOrEqual(2);
  });

  it("but does not move birthRate so fast it would peg the index in under a few years", () => {
    const perYear = strongestBirthRateTickPerYear(law, country);
    // Keep it a meaningful policy, not an instant flip: < 8 index/yr (≥ ~6 years to
    // cross the full 0-100 band at full tilt).
    expect(perYear, `birthRate Δ/yr = ${perYear.toFixed(3)}`).toBeLessThan(8);
  });
});
