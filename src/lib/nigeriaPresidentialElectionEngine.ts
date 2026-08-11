/**
 * Nigeria presidential election resolution — a bespoke per-country engine
 * (parallel to the US electoral-college `presidentialElectionEngine`, which is
 * left untouched). Nigeria elects its President by national popular vote with a
 * federal-character spread requirement:
 *
 *   A candidate wins outright with the most national votes AND at least 25% of
 *   the vote in two-thirds of the geopolitical zones (≥4 of 6). Otherwise the
 *   top two candidates contest a run-off.
 *
 * This module is pure (no DB): it takes per-zone tallies and returns the
 * outcome. The scheduling (`ensureNGPresidentialElection`) and per-turn vote
 * accumulation reuse the country-agnostic election plumbing; only this
 * resolution rule is NG-specific.
 */

export const NG_ZONES = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
] as const;

/** Two-thirds of the six geopolitical zones. */
export const NG_SPREAD_ZONES_REQUIRED = 4;
/** Minimum vote share required in each "cleared" zone. */
export const NG_SPREAD_THRESHOLD = 0.25;

export interface NigeriaPresidentialResult {
  outcome: "won" | "runoff";
  /** Set when `outcome === "won"`. */
  winnerPartyId?: string;
  /** Set when `outcome === "runoff"` — the top two by national vote. */
  runoffPartyIds?: [string, string];
  /** National vote totals by party (for callers/telemetry). */
  national: Record<string, number>;
  /** Number of zones in which the national leader cleared the 25% threshold. */
  leaderZonesCleared: number;
}

/**
 * Resolve a Nigerian presidential election from per-zone vote tallies.
 *
 * @param zoneTallies map of zoneId → (partyId → vote count)
 */
export function resolveNigeriaPresidentialResult(
  zoneTallies: Record<string, Record<string, number>>
): NigeriaPresidentialResult {
  const national: Record<string, number> = {};
  for (const zone of NG_ZONES) {
    for (const [party, votes] of Object.entries(zoneTallies[zone] ?? {})) {
      national[party] = (national[party] ?? 0) + votes;
    }
  }

  const ranked = Object.entries(national).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) {
    return { outcome: "runoff", national, leaderZonesCleared: 0 };
  }

  const leader = ranked[0][0];
  let leaderZonesCleared = 0;
  for (const zone of NG_ZONES) {
    const zt = zoneTallies[zone] ?? {};
    const zoneTotal = Object.values(zt).reduce((sum, v) => sum + v, 0);
    if (zoneTotal > 0 && (zt[leader] ?? 0) / zoneTotal >= NG_SPREAD_THRESHOLD) {
      leaderZonesCleared++;
    }
  }

  if (leaderZonesCleared >= NG_SPREAD_ZONES_REQUIRED) {
    return { outcome: "won", winnerPartyId: leader, national, leaderZonesCleared };
  }

  const runoffPartyIds: [string, string] = [ranked[0][0], ranked[1]?.[0] ?? ranked[0][0]];
  return { outcome: "runoff", runoffPartyIds, national, leaderZonesCleared };
}
