import type { Db } from "mongodb";

/**
 * :30 half step for growth. See stepFraction.ts for the contract: apply
 * HALF_TICK_FRACTION of the coming turn's step and stamp every written
 * document with subhourStep in the same update; the turn applies the rest.
 *
 * STUB: implemented in this PR's growth track.
 */
export async function runGrowthHalfStep(
  _db: Db,
  _turn: number,
  _now: Date
): Promise<Record<string, unknown>> {
  return { skipped: "not implemented" };
}
