/**
 * Regional variation in presidential primaries.
 *
 * Almost every lever in the primary vote weight is national: reach, approval,
 * party fit, party influence, the NPP penalty, mood and momentum are the same
 * number in every state, so each candidate's ratio to their rivals carried
 * straight through to every state's share. Rivals in one party also sit on the
 * same side of both axes, so the per-state ideology term barely told them
 * apart. The result was a primary map that read the same coast to coast.
 *
 * Three levers, all presidential-primary only (general elections are not
 * touched):
 *
 * 1. A fixed per-state swing per candidate: a log-normal multiplier drawn from
 *    a hash of the race, the state and the candidate. It is a pure function of
 *    those ids, so a race always replays identically (singleplayer reloads, the
 *    projection and the live wave agree) and no rng has to be threaded through.
 * 2. Ideology counts for more: each demographic group's appeal is raised to a
 *    power above one before the group's vote is split, which widens the gap
 *    between a candidate who fits a state's primary voters and one who does
 *    not.
 * 3. A home-region pull: a candidate does a little better across their home
 *    state's census division, not only in the home state itself.
 *
 * Plain data in, plain data out: no database, clock, environment or
 * `Math.random`.
 */

/** Spread of the per-state swing: the log-normal sigma. 0.15 is about ±15% at one sigma. */
export const PRIMARY_STATE_SWING_SIGMA = 0.15;
/** The swing's z-score is clamped here so no state gets a freak multiplier. */
export const PRIMARY_STATE_SWING_Z_CAP = 2.5;
/** Exponent applied to group appeal in presidential primaries. 1 would be the old behaviour. */
export const PRIMARY_APPEAL_SHARPNESS = 1.5;
/** Bonus across the candidate's home census division, outside the home state itself. */
export const HOME_DIVISION_BONUS_PRIMARY = 0.06;

/** FNV-1a 32-bit, mapped into the open interval (0, 1). */
export function hashUnit(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Keep away from 0 and 1 so the log in Box-Muller is finite.
  return ((h >>> 0) + 0.5) / 4294967296;
}

/** A standard normal draw that is a pure function of `key` (Box-Muller). */
export function hashNormal(key: string): number {
  const u1 = hashUnit(`${key}#u1`);
  const u2 = hashUnit(`${key}#u2`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * The fixed swing for one candidate in one state of one race, a multiplier
 * around 1 (median exactly 1). `seed` identifies the race; a missing seed or
 * state means no swing.
 */
export function primaryStateSwing(
  seed: string | null | undefined,
  stateId: string | null | undefined,
  candidateId: string,
  sigma: number = PRIMARY_STATE_SWING_SIGMA
): number {
  if (!seed || !stateId || sigma <= 0) return 1;
  const z = hashNormal(`${seed}|${stateId}|${candidateId}`);
  const capped = Math.max(-PRIMARY_STATE_SWING_Z_CAP, Math.min(PRIMARY_STATE_SWING_Z_CAP, z));
  return Math.exp(sigma * capped);
}

/** Group appeal sharpened for a presidential primary. Non-positive appeal stays at zero. */
export function sharpenPrimaryAppeal(
  appeal: number,
  sharpness: number = PRIMARY_APPEAL_SHARPNESS
): number {
  return appeal > 0 ? Math.pow(appeal, sharpness) : 0;
}

/** US Census Bureau divisions. DC sits in the South Atlantic division. */
// prettier-ignore
export const US_CENSUS_DIVISION: Readonly<Record<string, string>> = {
  CT: "NE", ME: "NE", MA: "NE", NH: "NE", RI: "NE", VT: "NE",
  NJ: "MA", NY: "MA", PA: "MA",
  IL: "ENC", IN: "ENC", MI: "ENC", OH: "ENC", WI: "ENC",
  IA: "WNC", KS: "WNC", MN: "WNC", MO: "WNC", NE: "WNC", ND: "WNC", SD: "WNC",
  DE: "SA", DC: "SA", FL: "SA", GA: "SA", MD: "SA", NC: "SA", SC: "SA", VA: "SA", WV: "SA",
  AL: "ESC", KY: "ESC", MS: "ESC", TN: "ESC",
  AR: "WSC", LA: "WSC", OK: "WSC", TX: "WSC",
  AZ: "MT", CO: "MT", ID: "MT", MT: "MT", NV: "MT", NM: "MT", UT: "MT", WY: "MT",
  AK: "PAC", CA: "PAC", HI: "PAC", OR: "PAC", WA: "PAC",
};

/**
 * The home-region multiplier for a candidate in `stateId`: the division bonus
 * when the state shares the home state's division, 1 otherwise. The home
 * state itself is excluded; it has its own, larger bonus.
 */
export function homeDivisionMultiplier(
  homeStateId: string | null | undefined,
  stateId: string | null | undefined,
  bonus: number = HOME_DIVISION_BONUS_PRIMARY
): number {
  if (!homeStateId || !stateId || homeStateId === stateId) return 1;
  const home = US_CENSUS_DIVISION[homeStateId.toUpperCase()];
  const here = US_CENSUS_DIVISION[stateId.toUpperCase()];
  return home && home === here ? 1 + bonus : 1;
}
