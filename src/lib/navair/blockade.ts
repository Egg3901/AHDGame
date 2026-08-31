import * as R from "./config";
import * as M from "./map";
import { cv, alive, clamp } from "./engineCore";
import { homeRegionOf } from "@/lib/military/regionTopology";
import type { RegionCode } from "@/lib/military/types";
import type { NavairUnit } from "./types";

/**
 * Naval blockade, and how it reaches the economy.
 *
 * A blockade is NOT an embargo. An embargo is a political decision to stop trading; a
 * blockade is hulls in the water stopping trade that both parties still want. They
 * converge on the same effect and the code must keep them distinguishable, or the trade
 * layer loses the ability to say why a lane closed.
 *
 * Pressure is continuous. A partial blockade raises the cost of moving goods; only total
 * closure stops them. That falls out of the existing trade engine for free, because
 * `affinityFor` returns a continuous number and `isBlocked` is defined as affinity zero.
 */

/**
 * How much blockading force it takes to shut a country's seaborne trade completely.
 *
 * Scaled against the region's port rating, so a country with a big developed harbour is
 * genuinely harder to close than one with a single anchorage: `EMBARGO.portDefenceScale`
 * is the measured conversion, calibrated so a worn two ship blockade cannot move a major
 * port and a committed fleet can.
 */
export const BLOCKADE = {
  portDefenceScale: R.EMBARGO.portDefenceScale,
  /**
   * Floor on affinity from blockade alone, short of total closure.
   *
   * A blockade that is merely strong must not silently become total. Reaching zero has to
   * take genuinely overwhelming force, because zero is what flips `isBlocked` and hands
   * the flow to `reachableBook` as unreachable supply.
   */
  minAffinityMultiplier: 0.1,
} as const;

/**
 * The water through which a country's seaborne trade must pass.
 *
 * Its own region when that region touches water, plus every navigable region next to it.
 * This is decision 14: adjacency decides who a blockade affects, using topology the game
 * already has, rather than a hand authored lane table per country pair.
 */
export function tradeApproaches(region: RegionCode | undefined): RegionCode[] {
  if (!region) return [];
  const here = M.isWaterAccessible(region) ? [region] : [];
  const adjacent = M.neighbors(region).filter(M.isNavigable) as RegionCode[];
  return [...new Set([...here, ...adjacent])];
}

/**
 * How completely hostile fleets have closed one country's approaches, 0..1.
 *
 * Only formations actually ON blockade or sea denial count, weighted by the `embargo`
 * share of their posture: a fleet fighting for sea control is contesting the water, not
 * closing it, and a fleet in transit is doing neither.
 *
 * `hostileTo` decides whose hulls count. A neutral fleet in the same water closes
 * nothing, or a superpower could strangle a country's trade by parking ships near it
 * without ever declaring war.
 */
export function blockadeClosureFor(
  countryId: string,
  units: readonly NavairUnit[],
  hostileTo: ReadonlySet<string>
): number {
  const approaches = tradeApproaches(homeRegionOf(countryId));
  if (!approaches.length) return 0;

  let worst = 0;
  for (const region of approaches) {
    let pressure = 0;
    for (const u of units) {
      if (!alive(u) || u.domain !== "naval" || u.station !== region) continue;
      if (!hostileTo.has(u.countryId)) continue;
      // `embargo` is the share of a hull's value that counts toward closing a lane.
      // BLOCKADE is 1.0, SEA_DENIAL 0.7, SEA_CONTROL 0.55, ESCORT 0.15, transit and port 0.
      pressure += cv(u, "embargo");
    }
    if (pressure <= 0) continue;

    const port = M.region(region)?.port ?? 0;
    const defence = Math.max(1, port * BLOCKADE.portDefenceScale);
    const closure = clamp(pressure / (pressure + defence), 0, 1);
    if (closure > worst) worst = closure;
  }

  // The WORST approach, not the sum: closing one of three routes into a country does not
  // close the country. A blockade bites when it shuts the way in that actually matters.
  return worst;
}

/**
 * Blockade closure for every country, computed once per turn.
 *
 * Returns only countries under actual pressure, so the common case (nobody is blockading
 * anybody) is an empty map and the trade layer pays nothing for this feature existing.
 */
export function blockadeClosureByCountry(
  units: readonly NavairUnit[],
  hostility: ReadonlyMap<string, Set<string>>
): Map<string, number> {
  const out = new Map<string, number>();
  // Only countries with a hostile navy somewhere can be under blockade, so iterate the
  // hostility map rather than every country in the world.
  for (const [countryId, enemies] of hostility) {
    if (!enemies.size) continue;
    const closure = blockadeClosureFor(countryId, units, enemies);
    if (closure > 0) out.set(countryId, closure);
  }
  return out;
}

/**
 * The multiplier a blockade applies to trade affinity for flows into or out of a country.
 *
 * Total closure returns 0, which is what the existing `isBlocked` reads, so a fully
 * blockaded country's supply lands in `reachableBook` as unreachable exactly as an
 * embargoed flow does. Short of total, it is a continuous drag that never quite reaches
 * zero on its own.
 */
export function blockadeAffinityMultiplier(closure: number): number {
  if (closure >= 1) return 0;
  return Math.max(BLOCKADE.minAffinityMultiplier, 1 - closure);
}
