/**
 * NPP engine 6.13: autonomous central banks defend a falling currency (v6).
 *
 * 6.6 moves the rate target when a floating currency moves. A sharp fall can
 * outrun a rate that moves in limited steps, and the chair's other tool, an
 * intervention band backed by reserves, was only ever set by player chairs.
 * At v6 an autonomous chair sets a band once its currency has fallen at least
 * `DEFENCE_TRIGGER` over the lookback: a ceiling a little above today's rate
 * caps further weakening, a wide floor leaves room to recover. The forex turn
 * then defends it with the bank's own reserves under the existing funding
 * rules, so the band can never spend more than the bank holds. The chair takes
 * its band down once the move has settled back inside `DEFENCE_RELEASE`.
 */

/** Fall over the lookback (fraction) that triggers a defence band. */
export const DEFENCE_TRIGGER = 0.15;
/** Move back inside which the chair removes its own band. */
export const DEFENCE_RELEASE = 0.05;
/** Ceiling above today's rate: further weakening the band allows. */
export const DEFENCE_CEILING_ROOM = 0.05;
/** Floor below today's rate. */
export const DEFENCE_FLOOR_ROOM = 0.1;

/** Band for a defence, clamped to the guardrails; null if it cannot fit. */
export function defenceBand(
  rate: number,
  guardrails: { floor: number; ceiling: number }
): { floor: number; ceiling: number } | null {
  if (!(rate > 0)) return null;
  const floor = Math.max(guardrails.floor, rate * (1 - DEFENCE_FLOOR_ROOM));
  const ceiling = Math.min(guardrails.ceiling, rate * (1 + DEFENCE_CEILING_ROOM));
  return floor < ceiling ? { floor, ceiling } : null;
}

export type DefenceAction = "set" | "release" | "none";

/**
 * What the chair does this turn. `ownBand` is true when the active band is one
 * this autonomous chair set; a band someone else set is never touched.
 */
export function defenceAction(params: {
  depreciation: number | null;
  hasBand: boolean;
  ownBand: boolean;
  turnsSinceBandChange: number | null;
  cooldownTurns: number;
}): DefenceAction {
  const { depreciation, hasBand, ownBand } = params;
  if (depreciation == null) return "none";
  if (!hasBand) return depreciation >= DEFENCE_TRIGGER ? "set" : "none";
  if (!ownBand) return "none";
  const cooled =
    params.turnsSinceBandChange == null || params.turnsSinceBandChange >= params.cooldownTurns;
  return cooled && Math.abs(depreciation) < DEFENCE_RELEASE ? "release" : "none";
}
