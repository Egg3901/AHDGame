/**
 * Cross-fund service order for the budgeted queued-redemption pass (#3366).
 *
 * The pass shares one claim budget across every fund with a queue. When more
 * funds wait than there are claims, a fixed order would hand the same leading
 * funds every claim, every turn, and the rest would never be paid. Funds are
 * ordered by stable id and the start rotates by one budget's worth per turn,
 * so with an unchanged set of queued funds every fund is first in line at
 * least once in any ceil(funds / budget) consecutive turns.
 */
export function orderQueuedRedemptionFunds(
  fundIds: readonly string[],
  claimsPerPass: number,
  turn: number
): string[] {
  const sorted = [...new Set(fundIds)].sort();
  const n = sorted.length;
  if (n === 0) return sorted;
  const step = Math.max(1, Math.floor(claimsPerPass)) % n;
  const t = Number.isFinite(turn) ? Math.max(0, Math.floor(turn)) : 0;
  // (t * step) mod n without overflowing a safe integer on long-lived worlds.
  const offset = ((t % n) * step) % n;
  return [...sorted.slice(offset), ...sorted.slice(0, offset)];
}

/**
 * Claims the next fund in line may make: an even split of what is left over
 * the funds still waiting, rounded up so a small budget still reaches the
 * front of the rotation. Claims a fund leaves unused roll forward.
 */
export function queuedRedemptionClaimShare(claimsLeft: number, fundsLeft: number): number {
  if (claimsLeft <= 0) return 0;
  return Math.ceil(claimsLeft / Math.max(1, fundsLeft));
}
