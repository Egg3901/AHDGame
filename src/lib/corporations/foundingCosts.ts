import { CORPORATION_FOUNDING_COST, CORPORATION_STARTING_CAPITAL } from "../constants/corporations";
import { getEraNominalAmount } from "../constants/sectorSeedEra";
import { COUNTRY_CURRENCY_MAP, INITIAL_RATES } from "../constants/currencies";
import type { CountryId } from "../constants/countries";
import {
  INVESTOR_CONFIDENCE_BASELINE,
  FOUNDING_CONFIDENCE_PENALTY_MAX,
} from "@/lib/nationalization/constants";

/**
 * Founding-cost multiplier from low investor confidence (spec §12.4 feed 3).
 * 1.0 at/above baseline; up to 1 + FOUNDING_CONFIDENCE_PENALTY_MAX at confidence 0.
 * Capital is shy when expropriation risk is high, so new ventures cost more.
 */
export function getFoundingConfidenceMultiplier(
  investorConfidence: number | null | undefined
): number {
  if (investorConfidence == null || !Number.isFinite(investorConfidence)) return 1;
  if (investorConfidence >= INVESTOR_CONFIDENCE_BASELINE) return 1;
  const below = INVESTOR_CONFIDENCE_BASELINE - Math.max(0, investorConfidence);
  return 1 + FOUNDING_CONFIDENCE_PENALTY_MAX * (below / INVESTOR_CONFIDENCE_BASELINE);
}

/**
 * Local-currency units per ₳ charged at founding for a corp in `countryId`.
 *
 * Single source of truth shared by the founding API route and the
 * FoundCorporationModal so the fee/treasury figures the player sees can never
 * disagree with what the server charges. Uses INITIAL_RATES (not the live DB
 * rate) to match migration.ts calibration — corps founded at different exchange
 * levels must start equally.
 *
 * Returns 1 (no conversion) when forex is off, the country is USD, or the
 * country is unknown / not yet loaded on the client.
 */
export function getFoundingFxRate(
  countryId: CountryId | null | undefined,
  forexEnabled: boolean
): number {
  if (!forexEnabled || !countryId) return 1;
  if (COUNTRY_CURRENCY_MAP[countryId] === "USD") return 1;
  return INITIAL_RATES[countryId] ?? 1;
}

export interface FoundingCostInput {
  /** Starting capital the founder commits to the corp treasury, in ₳ (anchor). */
  startingCapitalAnchor: number;
  /**
   * Local-currency units per ₳ for the corp's country (e.g. CN 7.2, JP 106).
   * Pass 1.0 for USD or when forex is disabled.
   */
  foundingRate: number;
  /**
   * Active world preset. Deflates the fee and the baseline capital into the
   * era's money. Omit for modern behaviour.
   */
  preset?: string;
  /**
   * Low-confidence founding premium multiplier (≥1; from
   * `getFoundingConfidenceMultiplier`). Default 1 (no premium). Applied to the
   * founding-FEE leg only; the corp seed is never reduced (spec §12.4 feed 3).
   */
  confidenceMultiplier?: number;
}

export interface FoundingCostResult {
  /** Corp treasury seed, in the corp's local currency. */
  corpStartingCapital: number;
  /** Total charged to the founder, in their (local) home currency. */
  totalPlayerCost: number;
  /** Extra capital committed above baseline, in ₳ (for ledger meta). */
  extraCapitalOverBaselineAnchor: number;
  /**
   * Confidence premium charged above the money-conserving baseline (local
   * currency) — the founding route credits this to the country treasury.
   */
  confidencePremiumLocal: number;
}

/**
 * Pure computation of the two founding money legs in LOCAL currency.
 *
 * Both the corp treasury seed AND the founder's charge are scaled by the same
 * `foundingRate` so fee and seed stay in the same local currency.
 *
 * With fee == baseline capital the founder pays exactly the seed (system grant
 * = baseline − fee = 0); any extra commitment is charged on top, also in local.
 */
export function computeFoundingCosts({
  startingCapitalAnchor,
  foundingRate,
  confidenceMultiplier = 1,
  preset,
}: FoundingCostInput): FoundingCostResult {
  // Era money. A 1953 world's economy is ~70x smaller in nominal terms, and its
  // starting cash is deflated to match, so an unscaled fee would put founding
  // out of reach of every character in the era. Defaults reproduce the modern
  // numbers exactly when no preset is supplied.
  const baselineCapital = getEraNominalAmount(CORPORATION_STARTING_CAPITAL, preset);
  const foundingCost = getEraNominalAmount(CORPORATION_FOUNDING_COST, preset);
  const extraCapitalOverBaselineAnchor = startingCapitalAnchor - baselineCapital;
  const mult = Math.max(1, confidenceMultiplier);
  // The fee leg carries the confidence premium; the corp seed is unchanged. At
  // mult=1 the founder pays exactly the seed (conserving); above 1 the surplus
  // (`confidencePremiumLocal`) is captured by the treasury at the route.
  const feeAnchor = foundingCost * mult;
  const totalPlayerCostAnchor = feeAnchor + extraCapitalOverBaselineAnchor;
  const premiumAnchor = foundingCost * (mult - 1);

  return {
    corpStartingCapital: Math.round(startingCapitalAnchor * foundingRate),
    totalPlayerCost: Math.round(totalPlayerCostAnchor * foundingRate),
    extraCapitalOverBaselineAnchor,
    confidencePremiumLocal: Math.round(premiumAnchor * foundingRate),
  };
}
