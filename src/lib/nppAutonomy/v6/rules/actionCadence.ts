/**
 * NPP engine 6.0: staggered action cycle.
 *
 * Below v6 every NPP takes its action cycle on the same turn, one turn in
 * every `NPP_ACTION_INTERVAL`, so that one turn carries the whole cost (live
 * turn 168: 27.6s, of which 18.0s stock buying and 4.7s bond buying) and the
 * other three carry none of it.
 *
 * At v6 each NPP is assigned a fixed lane from its id and acts on the turns of
 * that lane. Every NPP still acts exactly once per interval, with the action
 * points it accumulated over the interval, so the per-NPP cadence and budget
 * are unchanged; only which quarter of NPPs acts on a given turn differs.
 */

export const NPP_ACTION_INTERVAL = 4;

/**
 * Stable lane for an NPP, from the low bytes of its ObjectId hex (the
 * per-process counter, evenly spread). Anything that is not a 24-hex id falls
 * back to a string hash so a fixture id still gets a lane.
 */
export function nppActionLane(id: { toString(): string }, interval = NPP_ACTION_INTERVAL): number {
  const hex = id.toString();
  if (/^[0-9a-f]{24}$/i.test(hex)) {
    return parseInt(hex.slice(-6), 16) % interval;
  }
  let hash = 0;
  for (let i = 0; i < hex.length; i++) hash = (hash * 31 + hex.charCodeAt(i)) >>> 0;
  return hash % interval;
}

/** The lane whose NPPs act on this turn. */
export function actingLane(turn: number, interval = NPP_ACTION_INTERVAL): number {
  return ((turn % interval) + interval) % interval;
}

/** Whether this NPP takes its action cycle on this turn under the staggered cadence. */
export function nppActsThisTurn(
  id: { toString(): string },
  turn: number,
  interval = NPP_ACTION_INTERVAL
): boolean {
  return nppActionLane(id, interval) === actingLane(turn, interval);
}
