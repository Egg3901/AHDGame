/**
 * Fundraise costs FUNDRAISE_ACTION_COST action points and requires donors.
 * fundraiseYieldAnchor scales the yield with donor level, political influence,
 * and the fundraising stat. Hosts own currency conversion and persistence.
 */
import { statMultiplier } from "../stats/statMultiplier";
import { NEUTRAL_STAT } from "../stats/statsConstants";

/** Action points charged per Fundraise use: flat at every donor level. */
export const FUNDRAISE_ACTION_COST = 3;

/**
 * Minimal fundraise actor. Structurally compatible with Character: pass a
 * Character wherever this is accepted. Characters that predate the stat
 * system omit `stats` and get the neutral fallback (1.0x multiplier).
 */
export interface FundraiseActor {
  donorBaseLevel: number;
  politicalInfluence?: number;
  stats?: { fundraising?: number };
}

/**
 * Per-use fundraising yield in ANCHOR units, before the fundraising stat
 * multiplier.
 * $50K floor + $2K per donor base level (calibrated for 0-75 range),
 * scaled by state influence multiplier (1.0x at 0% to 2.0x at 100%).
 * L0/0%: $50K, L50/50%: $225K, L75/100%: $400K.
 */
export function calculateFundraisingAmount(
  donorBaseLevel: number,
  stateInfluence?: number
): number {
  const base = 50_000 + donorBaseLevel * 2_000;
  if (stateInfluence === undefined) return base;
  const multiplier = 1 + Math.max(0, Math.min(100, stateInfluence)) / 100;
  return Math.round(base * multiplier);
}

/**
 * Canonical per-use Fundraise yield in ANCHOR units, including the fundraising
 * stat multiplier. The single source of truth: the Fundraise action effect
 * and every UI that quotes the yield must call this, or the quote and the
 * credit drift apart (ticket 1107).
 */
export function fundraiseYieldAnchor(actor: FundraiseActor): number {
  const base = calculateFundraisingAmount(actor.donorBaseLevel, actor.politicalInfluence ?? 0);
  const stat = actor.stats?.fundraising ?? NEUTRAL_STAT;
  return Math.round(base * statMultiplier(stat));
}

/**
 * Fundraise eligibility: fundraising requires an established donor base, so
 * donor level zero is ineligible. Mirrors the execute gate exactly.
 */
export function isFundraiseEligible(donorBaseLevel?: number | null): boolean {
  return (donorBaseLevel ?? 0) !== 0;
}
