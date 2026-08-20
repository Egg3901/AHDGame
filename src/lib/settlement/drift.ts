/**
 * Bonn's own movement — the NPC in the middle of the German Question.
 *
 * West Germany is not player-enabled, so its domestic politics cannot be a
 * seat. They are a pull instead: mean-reverting toward an authored anchor, plus
 * noise drawn from a band the players are never shown.
 *
 * WHY MEAN REVERSION AND NOT A CONSTANT PUSH. A constant push West carries an
 * unplayed crisis to the lock threshold in about fifteen turns, so a "standing
 * crisis, no expiry" would keep quietly closing itself. Reverting to an anchor
 * settles an unplayed crisis between the two thresholds, where it can stand
 * indefinitely, and makes resistance rise the further either bloc drags Bonn
 * from its natural position — the same shape as `NON_ALIGNED_RESISTANCE` in
 * `src/lib/alignment/drift.ts`.
 *
 * Every value is integer hundredths and the rng is seeded, so a replayed turn
 * produces the identical roll.
 */
import { DRIFT_K_PCT, DRIFT_NOISE_SPAN, getInstitution } from "@/lib/constants/settlementCrisis";

/** Seed for a turn's drift rolls. One rng is drawn per tick and shared. */
export function driftSeedFor(turn: number): string {
  return `settlement.germanQuestion:drift:${turn}`;
}

/**
 * One institution's drift for this tick, in signed hundredths.
 *
 * `rng` is advanced exactly once per call, so callers must iterate institutions
 * in a stable order for the sequence to be reproducible.
 */
export function rollInstitutionDrift(params: {
  institutionId: string;
  position: number;
  rng: () => number;
}): number {
  const { institutionId, position, rng } = params;
  // Advance the rng BEFORE the anchor lookup can return early, or an unknown
  // institution would desynchronise every later institution's roll.
  const unit = rng() * 2 - 1;
  const noise = Math.round(unit * DRIFT_NOISE_SPAN);

  const def = getInstitution(institutionId);
  if (!def) return noise;

  const reversion = Math.round((-DRIFT_K_PCT * (position - def.anchor)) / 100);
  return reversion + noise;
}

/** The drift the INDEX moved by, given each institution's roll and weight. */
export function weightedDrift(rolls: readonly { weight: number; drift: number }[]): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const roll of rolls) {
    weighted += roll.drift * roll.weight;
    totalWeight += roll.weight;
  }
  if (totalWeight <= 0) return 0;
  return Math.round(weighted / totalWeight);
}
