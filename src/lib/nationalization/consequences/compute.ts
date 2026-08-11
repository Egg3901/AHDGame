/**
 * Pure consequence math (spec §12). No DB. All magnitudes from constants.
 */
import {
  INVESTOR_CONFIDENCE_BASELINE,
  CONFIDENCE_RECOVERY_PER_TURN,
  CONFIDENCE_BASE_EXPROPRIATION_HIT,
  CONFIDENCE_SEIZURE_SURCHARGE,
  CONFIDENCE_POPULAR_HIT_FACTOR,
  CONFIDENCE_TIER_WEIGHT,
  POLITICAL_TIER_WEIGHT,
  APPROVAL_PUBLIC_TRUST_HIT,
  APPROVAL_PUBLIC_TRUST_BOOST,
  LEGITIMACY_HIT_BASE,
  IDEOLOGY_MULTIPLIER_MIN,
  IDEOLOGY_MULTIPLIER_MAX,
  PRIVATIZATION_CONFIDENCE_BOOST_BASE,
  PRIVATIZATION_APPROVAL_NUDGE,
  PRIVATIZATION_LEGITIMACY_NUDGE,
} from "../constants";
import type { CompensationTier } from "../constants";
import type { NationalizationTrigger } from "./types";

/**
 * Confidence points to subtract for one taking, split in two:
 *   • BASE — fires on the ACT of expropriating a private owner regardless of
 *     payment, scaled by the SOCI escalation multiplier, ideology, and a
 *     popularity factor (popular takings scar less).
 *   • SURCHARGE — the EXTRA for underpaying (the old compensation softener),
 *     scaled by tier weight × the unpaid fraction. A fully-paid taking zeroes it.
 * The sum is clamped ≥ 0.
 */
export function computeConfidenceHit(input: {
  tier: CompensationTier;
  valuationAnchor: number;
  compensationAnchor: number;
  ideologyMultiplier: number;
  /** SOCI escalation factor (`sociMultiplier(soci)`, ≥ 1). */
  concentrationMultiplier: number;
  popularity: "popular" | "unpopular";
}): number {
  const valuation = Math.max(0, input.valuationAnchor);
  const paidRatio =
    valuation > 0 ? Math.max(0, Math.min(1, input.compensationAnchor / valuation)) : 1;
  const popularityFactor = input.popularity === "popular" ? CONFIDENCE_POPULAR_HIT_FACTOR : 1;

  const base =
    CONFIDENCE_BASE_EXPROPRIATION_HIT *
    input.concentrationMultiplier *
    input.ideologyMultiplier *
    popularityFactor;

  const tierWeight = CONFIDENCE_TIER_WEIGHT[input.tier];
  const surcharge =
    CONFIDENCE_SEIZURE_SURCHARGE * tierWeight * (1 - paidRatio) * input.ideologyMultiplier;

  return Math.max(0, base + surcharge);
}

/** One turn of healing toward baseline. */
export function computeConfidenceRecovery(current: number): number {
  const gap = INVESTOR_CONFIDENCE_BASELINE - current;
  return current + gap * CONFIDENCE_RECOVERY_PER_TURN;
}

/** Negative legitimacy delta for a taking (confidence-model countries). */
export function computeLegitimacyDelta(input: {
  tier: CompensationTier;
  ideologyMultiplier: number;
  /** SOCI escalation factor (`sociMultiplier(soci)`, ≥ 1). */
  concentrationMultiplier: number;
}): number {
  const tierWeight = POLITICAL_TIER_WEIGHT[input.tier];
  return (
    -LEGITIMACY_HIT_BASE * tierWeight * input.ideologyMultiplier * input.concentrationMultiplier
  );
}

/**
 * Signed public-trust nudge for a taking (spec §4.3). Assumes a private
 * expropriation (the caller gates NPC/unowned to 0).
 *   • UNPOPULAR — a penalty that deepens with concentration and ideology.
 *   • POPULAR — a boost at low state ownership that decays and FLIPS NEGATIVE as
 *     concentration climbs past the danger zone (the public sours on a state
 *     that owns everything). `concentrationMultiplier` is 1.0 below the danger
 *     zone, so the boost is full there.
 */
export function computeApprovalNudge(input: {
  popularity: "popular" | "unpopular";
  tier: CompensationTier;
  ideologyMultiplier: number;
  concentrationMultiplier: number;
}): number {
  const seizureScale = POLITICAL_TIER_WEIGHT[input.tier];
  if (input.popularity === "popular") {
    const raw =
      APPROVAL_PUBLIC_TRUST_BOOST - APPROVAL_PUBLIC_TRUST_HIT * (input.concentrationMultiplier - 1);
    return raw * seizureScale;
  }
  return (
    -APPROVAL_PUBLIC_TRUST_HIT *
    seizureScale *
    input.ideologyMultiplier *
    input.concentrationMultiplier
  );
}

/**
 * Ideology multiplier on the political cost. `economicAxis` is -1 (fully
 * statist) .. +1 (fully market-liberal); null ⇒ neutral (1.0). Statist
 * governments pay less to nationalize; market-liberal ones pay more.
 */
export function computeIdeologyMultiplier(economicAxis: number | null): number {
  if (economicAxis === null || !Number.isFinite(economicAxis)) return 1;
  const axis = Math.max(-1, Math.min(1, economicAxis));
  // axis -1 → MIN, 0 → 1.0, +1 → MAX (piecewise-linear through 1.0 at 0).
  if (axis <= 0) return 1 + axis * (1 - IDEOLOGY_MULTIPLIER_MIN);
  return 1 + axis * (IDEOLOGY_MULTIPLIER_MAX - 1);
}

/**
 * Privatization consequences (spec §12.1) — the mirror of a taking.
 * Privatizing RAISES investor confidence by a bounded, ideology-independent
 * amount (the market reads any state retreat as a pro-market signal).
 */
export function computePrivatizationConfidenceBoost(): number {
  return PRIVATIZATION_CONFIDENCE_BOOST_BASE;
}

/**
 * Public-trust nudge for a privatization. `ideologyMultiplier` ∈ [0.5,1.5]
 * (statist..market, 1.0 neutral); a market govt is rewarded for selling, a
 * statist one pays a political cost. Linear through 0 at neutral.
 */
export function computePrivatizationApprovalNudge(ideologyMultiplier: number): number {
  return PRIVATIZATION_APPROVAL_NUDGE * (ideologyMultiplier - 1);
}

/** Legitimacy delta for a privatization (confidence-model countries), same ideology direction. */
export function computePrivatizationLegitimacyDelta(ideologyMultiplier: number): number {
  return PRIVATIZATION_LEGITIMACY_NUDGE * (ideologyMultiplier - 1);
}

/** Popular (approval up) vs unpopular (approval down) framing of a taking. */
export function classifyTakingPopularity(
  triggers: NationalizationTrigger[]
): "popular" | "unpopular" {
  // Rescuing jobs (distress) or breaking a monopoly polls well; a bare
  // strategic-sector / supermajority seizure of a going concern does not.
  if (triggers.includes("distress") || triggers.includes("monopoly")) return "popular";
  return "unpopular";
}
