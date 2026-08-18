/**
 * Shared NPP stance-target model.
 *
 * The old drift (see nppStanceDrift.ts) walked every flexible NPP straight to
 * its home state's electorate centre (`cachedEconomicLean` / `cachedSocialLean`).
 * That point maximises the dominant term of the vote-appeal kernel, so over a
 * long-running world every non-stubborn NPP of BOTH parties collapsed onto the
 * same state lean: party contrast vanished (a DEM at party -1 and an FLP at 0
 * both ended up at the state's -0.7) and a fixed-position human could never
 * out-position them.
 *
 * The target is now anchored on the NPP's PARTY position and pulled only part of
 * the way toward the state lean, plus a stable per-NPP offset so same-party,
 * same-state NPPs still differ. The party anchor (kept because `leanPull < 1`)
 * and the offset are what stop the mimicry while still letting an NPP tilt toward
 * the state it represents.
 *
 * Both the ongoing drift and the one-off re-scatter heal compute their target
 * through {@link nppStanceTarget}, so a healed NPP already sits on its drift
 * target and the next drift cycle leaves it be instead of re-mimicking.
 */

/** How far an NPP sits from its party toward its state lean. 0 = pure party, 1 = full mimic. */
export const NPP_LEAN_PULL = 0.35;
/** Half-width of the stable per-NPP idiosyncratic spread around the anchor, on the -5..+5 axis. */
export const NPP_STANCE_SPREAD = 0.8;

const AXIS_MIN = -5;
const AXIS_MAX = 5;

export type StanceAxis = "economic" | "social";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Deterministic FNV-1a hash of a string to a uint32. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Stable per-NPP offset in [-spread, +spread], derived from the NPP id + axis.
 * Deterministic so the drift converges to a fixed target (never chases a moving
 * random point) and the heal reproduces the exact same value for the same NPP.
 */
export function nppIdiosyncrasy(
  nppId: string,
  axis: StanceAxis,
  spread: number = NPP_STANCE_SPREAD
): number {
  const u = hashString(`${nppId}:${axis}`) / 0xffffffff; // [0, 1]
  return (u * 2 - 1) * spread;
}

/**
 * Target stance for one axis: the party position pulled part-way to the state
 * lean, plus the stable per-NPP offset, clamped to [-5, 5] and rounded to the
 * 0.1 grid the engine stores.
 *
 * @param partyPosition NPP's party position on this axis (-5..+5); 0 for
 *   party-less / independent NPPs, matching the generator's default.
 * @param stateLean home state's cached lean on this axis (-5..+5).
 */
export function nppStanceTarget(
  partyPosition: number,
  stateLean: number,
  nppId: string,
  axis: StanceAxis,
  leanPull: number = NPP_LEAN_PULL,
  spread: number = NPP_STANCE_SPREAD
): number {
  const anchor = partyPosition + leanPull * (stateLean - partyPosition);
  const withOffset = anchor + nppIdiosyncrasy(nppId, axis, spread);
  const clamped = Math.max(AXIS_MIN, Math.min(AXIS_MAX, withOffset));
  return round1(clamped);
}
