import * as R from "./config";
import * as M from "./map";
import { alive, archetypeRadius } from "./engineCore";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";
import type { NavairUnit } from "./types";

/**
 * Fog of war for the naval and air layer.
 *
 * Detection is what makes position mean anything. Without it a submarine is a weak
 * destroyer, sea denial is a worse sea control, and recon patrol is a wasted turn. With
 * it, hiding is a strategy and finding is a cost.
 *
 * Levels are 0..3 and read as: nothing, something is out there, a usable fix, and a
 * targeting solution. A strike needs a usable fix (`config.STRIKE.minDetection`), which
 * is why a fleet can be known to exist and still not be attackable.
 */

/**
 * Detection one country holds over every region this turn, from presence alone.
 *
 * Deliberately computed from scratch each turn rather than accumulated. What you can see
 * is a function of what you have out there NOW; persistence is handled separately by
 * decaying last turn's figure in `channels.advanceChannels`, so losing a patrol degrades
 * the picture over a few turns instead of blanking it instantly.
 */
export function detectionFromPresence(
  units: readonly NavairUnit[],
  countryId: CountryId,
  homeRegions: readonly RegionCode[]
): Map<RegionCode, number> {
  const level = new Map<RegionCode, number>();
  const bump = (region: RegionCode, v: number) => {
    if (v > (level.get(region) ?? 0)) level.set(region, v);
  };

  for (const u of units) {
    if (u.countryId !== countryId || !alive(u) || !u.station) continue;

    // Anything you have on station, you see completely.
    bump(u.station, R.DETECTION.PRESENT);
    // Being next door tells you something is there, and nothing more.
    for (const n of M.neighbors(u.station)) bump(n as RegionCode, R.DETECTION.PASSIVE_ADJACENT);

    if (u.domain === "air" && u.mission === "PATROL") {
      bump(u.station, R.DETECTION.PATROL_HERE);
      for (const n of M.within(u.station, archetypeRadius(u))) {
        bump(n as RegionCode, R.DETECTION.PATROL_ADJACENT);
      }
    }
  }

  // You always see your own home waters, whether or not anything is stationed there.
  for (const region of homeRegions) bump(region, R.DETECTION.PRESENT);

  return level;
}

/**
 * Whether `observer` can put a weapon on something in `region`.
 *
 * Knowing a fleet exists is not the same as being able to hit it, and this is the line
 * between the two.
 */
export function canTarget(detectionLevel: number): boolean {
  return detectionLevel >= R.STRIKE.minDetection;
}

/**
 * What a side is told about enemy strength, given how well it can see.
 *
 * Force composition is fogged in this game by design, so this returns a band and never a
 * number. At low detection the band is deliberately wide: a commander who has not scouted
 * should be uncertain, not merely less precise.
 */
export function enemyBand(own: number, enemy: number, detectionLevel: number): string {
  if (detectionLevel <= 0) return "No contact";
  if (enemy <= 0) return "No forces detected";
  if (detectionLevel === 1) return "Unidentified contacts";
  const r = enemy / Math.max(1, own);
  if (r < 0.5) return "Token resistance";
  if (r < 0.85) return "Weaker force";
  if (r <= 1.2) return "Evenly matched";
  if (r <= 2.0) return "Stronger force";
  return "Overwhelming force";
}
