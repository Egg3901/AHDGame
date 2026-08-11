import type { Corporation, Shareholder } from "@/lib/db/types/corporation";

/**
 * Founder supershares (dual-class structure, S#33).
 *
 * A corporation may adopt a dual-class share structure either at IPO (founder
 * opt-in) or later via an `adopt_supershares` shareholder vote. Adoption stamps
 * `superShareMultiplier` on the corp and marks the founding CEO's shares held
 * at that moment as supershares (`Shareholder.superShares`).
 *
 * Mechanics:
 * - Supershares are identical economically (dividends, dissolution payouts,
 *   buyouts are all per-share). Only governance vote weight differs.
 * - One supershare counts as `superShareMultiplier` votes; common shares and
 *   the public float count as 1 vote each.
 * - Supershares never transfer: buyers always receive common stock. The
 *   effective supershare count is `min(superShares, shares)`, so a founder
 *   selling down sells common first and their supershares erode only once
 *   their position falls below the recorded supershare count. Shares bought
 *   back later are common.
 * - Privatization is governed by voting power like any other shareholder vote:
 *   the eligibility gate to call a buyout and the buyout tally both weight by
 *   votes (supershares count), so a supervoting founder can take the corp
 *   private on control. Buyout PAYOUTS remain per-share/economic, so minority
 *   holders are still cashed out at full share value (see castPrivatizationVote
 *   / resolvePrivatizationVote).
 *
 * In exchange for keeping control, dual-class corps may float up to
 * SUPERSHARE_IPO_MAX_FLOAT_PCT at IPO instead of the standard IPO_MAX_FLOAT_PCT.
 */

/** Lowest vote multiplier a founder may pick for supershares. */
export const SUPERSHARE_MIN_MULTIPLIER = 2;

/** Highest vote multiplier a founder may pick for supershares (real-world dual-class standard). */
export const SUPERSHARE_MAX_MULTIPLIER = 10;

/**
 * IPO float cap for dual-class corps (vs IPO_MAX_FLOAT_PCT = 49 for
 * single-class). Supershares keep founder voting control, so the >50%
 * economic-dilution guard no longer needs to bind.
 */
export const SUPERSHARE_IPO_MAX_FLOAT_PCT = 75;

export function isValidSuperShareMultiplier(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SUPERSHARE_MIN_MULTIPLIER &&
    value <= SUPERSHARE_MAX_MULTIPLIER
  );
}

/** True when the corp has an adopted dual-class structure. */
export function hasSuperShares(corp: Pick<Corporation, "superShareMultiplier">): boolean {
  return isValidSuperShareMultiplier(corp.superShareMultiplier);
}

/**
 * Supershares the holder can actually vote with. The recorded count never
 * grows, and selling below it erodes it (shares sold are always common from
 * the buyer's perspective, so only `min(recorded, held)` remain super).
 */
export function effectiveSuperShares(holder: Pick<Shareholder, "shares" | "superShares">): number {
  return Math.max(0, Math.min(holder.superShares ?? 0, holder.shares));
}

/**
 * Governance vote weight for one shareholder entry:
 * common shares × 1 + supershares × multiplier.
 */
export function shareholderVotingPower(
  corp: Pick<Corporation, "superShareMultiplier">,
  holder: Pick<Shareholder, "shares" | "superShares">
): number {
  if (!hasSuperShares(corp)) return holder.shares;
  const superShares = effectiveSuperShares(holder);
  return holder.shares + superShares * ((corp.superShareMultiplier as number) - 1);
}

/**
 * Total eligible vote weight across the cap table (the denominator for pass
 * thresholds). The public float and all common shares count 1 each, so this is
 * totalShares plus the supershare bonus votes.
 */
export function totalVotingPower(
  // Only vote-weight fields are read from each holder, so client-side payload
  // shapes (e.g. ShareholderInfo with string characterIds) qualify too.
  corp: Pick<Corporation, "superShareMultiplier" | "totalShares"> & {
    shareholders?: Array<Pick<Shareholder, "shares" | "superShares">>;
  }
): number {
  const total = corp.totalShares ?? 0;
  if (!hasSuperShares(corp)) return total;
  const multiplier = corp.superShareMultiplier as number;
  const bonus = (corp.shareholders ?? []).reduce(
    (sum, holder) => sum + effectiveSuperShares(holder) * (multiplier - 1),
    0
  );
  return total + bonus;
}
