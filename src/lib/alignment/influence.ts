/**
 * Influence plays — the rudder.
 *
 * Drift is the tide a nation sits in; a play is a deliberate, paid push against
 * it. Plays feed the SAME pull vector `computeDrift` consumes, so they inherit
 * the non-aligned resistance, the locked gate, and the per-nation turn cap
 * without restating any of them.
 *
 * Nothing here fires on its own. The meter moves on what organisations actually
 * DO — an automatic rival answer used to eat half of every play, which taxed the
 * acting bloc and paid nobody. Rivals still cancel each other, but only by
 * spending: `computeDrift` nets opposing pulls before the cap.
 */
import type { AlignmentChannel, AlignmentPoleId } from "@/lib/constants/alignmentEras";
import type { AlignmentShares } from "./normalize";

/** Ceiling on one play, so a single cheque cannot end the Cold War. */
export const PLAY_MAX_POINTS = 10;
/** Share of a target's annual GDP that buys one point of its alignment. */
export const POINT_COST_GDP_SHARE = 0.01;

/**
 * Share points a spend buys against a target of this size.
 *
 * Priced against the target's own economy, because $100m goes a great deal
 * further in the Congo than in France, and a flat price made every nation on the
 * board cost the same to buy.
 *
 * Linear, and deliberately so: the square root this replaced existed to stop a
 * rich nation buying the world in one turn, and the per-nation turn cap plus
 * pull-netting now do that job twice over. Linear buys legibility instead — 1%
 * of their economy is 1 point, and a nation moves at most 5 points a turn, so
 * spending past 5% of their GDP is visibly wasted.
 *
 * UNIT TRAP: `targetGdpUsd` is ABSOLUTE USD. `loadGdpUsdMillionsByEntity`
 * returns USD *millions* — multiply by `GDP_MILLIONS_TO_USD` before calling, or
 * every play is mispriced by a factor of a million and nothing fails loudly.
 */
export function pointsForSpend(amountUsd: number, targetGdpUsd: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0;
  // A target we cannot price is refused, never free: zero here would make an
  // unpriceable nation cost nothing to flip.
  if (!Number.isFinite(targetGdpUsd) || targetGdpUsd <= 0) return 0;
  return Math.min(PLAY_MAX_POINTS, amountUsd / (targetGdpUsd * POINT_COST_GDP_SHARE));
}

export function pullForPlay(params: {
  channel: AlignmentChannel;
  amountUsd: number;
  /** The target's live annual GDP in ABSOLUTE USD. */
  targetGdpUsd: number;
  shares: AlignmentShares;
  poles: readonly AlignmentPoleId[];
}): Partial<Record<AlignmentPoleId, number>> {
  const points = pointsForSpend(params.amountUsd, params.targetGdpUsd) * params.channel.weight;
  if (points <= 0) return {};

  if (!params.poles.includes(params.channel.poleId)) return {};
  return { [params.channel.poleId]: points };
}
