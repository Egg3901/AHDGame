/**
 * Tax-slider mechanics (ruling #16, spec §5.1b): continuous-rate tax laws.
 * Proposals carry `proposedRate` + a synthetic policyOptionId "rate:<value>";
 * validation enforces bounds, grid alignment, and a minimum one-step move from
 * the CURRENT rate; NPC force comes from the DELTA (cuts read rightward, hikes
 * leftward) while the DISPLAY stance maps the absolute position separately.
 */

import type { Db } from "mongodb";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { LegislationType } from "@/lib/db/types/legislation";

const GRID_EPS = 1e-9;

export function taxSliderPolicyOptionId(proposedRate: number): string {
  return `rate:${proposedRate}`;
}

/**
 * Validate a slider proposal against its law + the current effective rate.
 * Returns a player-facing error string, or null when the proposal is valid.
 */
export function validateTaxSliderProposal(
  taxSlider: NonNullable<LegislationType["taxSlider"]>,
  proposedRate: number | undefined,
  currentRate: number,
  policyOptionId: string | undefined
): string | null {
  if (proposedRate === undefined || !Number.isFinite(proposedRate)) {
    return "A proposed rate is required for tax legislation.";
  }
  if (proposedRate < taxSlider.minRate || proposedRate > taxSlider.maxRate) {
    return `The proposed rate must be between ${taxSlider.minRate} and ${taxSlider.maxRate}.`;
  }
  const steps = (proposedRate - taxSlider.minRate) / taxSlider.step;
  if (Math.abs(steps - Math.round(steps)) > GRID_EPS) {
    return `The proposed rate must move in steps of ${taxSlider.step}.`;
  }
  if (Math.abs(proposedRate - currentRate) < taxSlider.step - GRID_EPS) {
    return `The proposal must change the rate by at least ${taxSlider.step}.`;
  }
  if (policyOptionId !== taxSliderPolicyOptionId(proposedRate)) {
    return "Tax proposals must carry the rate-encoded option id.";
  }
  return null;
}

/**
 * §5.1b NPC force override: the provision-level economic value synthesized from
 * the DELTA — clamp((currentRate − proposedRate) / scale, −5, +5) with
 * scale = (maxRate − minRate) / 10. Cuts read rightward (+), hikes leftward (−).
 */
export function taxSliderNpcEconomic(
  taxSlider: NonNullable<LegislationType["taxSlider"]>,
  currentRate: number,
  proposedRate: number
): number {
  const scale = (taxSlider.maxRate - taxSlider.minRate) / 10;
  if (scale <= 0) return 0;
  const force = (currentRate - proposedRate) / scale;
  return Math.max(-5, Math.min(5, force));
}

export type ResolvedTaxSliderFields =
  | {
      ok: true;
      fields: {
        proposedRate: number;
        policyOptionId: string;
        economic: number;
        social: 0;
        effectDirection: number;
        /** Rate-labeled snapshots so bill lists/detail show the move, not a
         * bare position label (sliders have no options to resolve names from). */
        policyOptionNameSnapshot: string;
        currentPolicyOptionNameSnapshot: string;
      };
    }
  | { ok: false; error: string };

/** Display label for a slider rate ("Rate: 38%"). Shared by snapshots + NPC titles. */
export function taxSliderRateLabel(rate: number): string {
  return `Rate: ${rate}%`;
}

/**
 * The rate one "notch" from current in `direction` — a tenth of the slider
 * range snapped to the step grid (minimum one step), clamped to bounds. Used
 * by NPC sponsorship. Returns null when the bound blocks any ≥1-step move.
 */
export function taxSliderNotchRate(
  taxSlider: NonNullable<LegislationType["taxSlider"]>,
  currentRate: number,
  direction: -1 | 1
): number | null {
  const range = taxSlider.maxRate - taxSlider.minRate;
  if (range <= 0 || taxSlider.step <= 0) return null;
  const steps = Math.max(1, Math.round(range / 10 / taxSlider.step));
  const target = currentRate + direction * steps * taxSlider.step;
  const clamped = Math.min(taxSlider.maxRate, Math.max(taxSlider.minRate, target));
  const k = Math.round((clamped - taxSlider.minRate) / taxSlider.step);
  const snapped = Number((taxSlider.minRate + k * taxSlider.step).toFixed(6));
  if (Math.abs(snapped - currentRate) < taxSlider.step - 1e-9) return null;
  return snapped;
}

/**
 * Server-side slider resolution for both propose routes: reads the CURRENT
 * effective rate from federalBudget.taxRates (the source of truth), validates
 * the proposal, and returns the stamped provision fields — the delta-derived
 * NPC economic force (§5.1b) and a sign-of-move effectDirection.
 */
export async function resolveTaxSliderProvisionFields(
  db: Db,
  legislationType: LegislationType,
  proposedRate: number | undefined,
  policyOptionId: string | undefined,
  countryId: string
): Promise<ResolvedTaxSliderFields> {
  const slider = legislationType.taxSlider;
  if (!slider) return { ok: false, error: "Not a tax-slider legislation type." };

  const budgetId = getNationalBudgetId(countryId as CountryId);
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budgetId }, { projection: { taxRates: 1 } });
  const currentRate =
    (budget?.taxRates as Record<string, number> | undefined)?.[slider.taxType] ??
    slider.baselineRate;

  // Clients may omit the encoded option id; derive it before validating so the
  // stored provision always carries it (duplicate-direction guard, spec §10).
  const encodedId =
    policyOptionId ??
    (proposedRate !== undefined ? taxSliderPolicyOptionId(proposedRate) : undefined);
  const error = validateTaxSliderProposal(slider, proposedRate, currentRate, encodedId);
  if (error) return { ok: false, error };

  const rate = proposedRate!;
  return {
    ok: true,
    fields: {
      proposedRate: rate,
      policyOptionId: taxSliderPolicyOptionId(rate),
      economic: taxSliderNpcEconomic(slider, currentRate, rate),
      social: 0,
      effectDirection: rate > currentRate ? 1 : -1,
      policyOptionNameSnapshot: taxSliderRateLabel(rate),
      currentPolicyOptionNameSnapshot: taxSliderRateLabel(currentRate),
    },
  };
}
