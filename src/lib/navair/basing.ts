import * as R from "./config";
import { berthCostOf, clamp, sum } from "./engineCore";
import * as M from "./map";
import { countriesInRegion, homeRegionOf } from "@/lib/military/regionTopology";
import { sharesBloc, type BlocLookup } from "@/lib/military/bloc";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";
import type { BasingKey } from "./config";
import type { NavairUnit } from "./types";

/**
 * Where a fleet can actually be sustained.
 *
 * This is the term that stops a superpower steamrolling by mass. A big fleet can go
 * anywhere; it cannot be SUSTAINED anywhere, and unsustained tonnage fights badly. It is
 * also the reason a blockade far from home is a commitment rather than a free action.
 *
 * Basing rights are derived from the game's own bloc and home-region data, never from a
 * hand-authored table. A country's alliances change during a game and the basing it can
 * count on has to change with them.
 */

/**
 * How a region stands toward one country.
 *
 * Your own home region is yours. A region that is home to somebody in your bloc is
 * allied. A region that is home to a country you are at war with is hostile. Everything
 * else is neutral and will sell you a berth at neutral rates.
 */
export function basingStatus(
  region: RegionCode,
  countryId: CountryId,
  blocs: BlocLookup,
  atWarWith: ReadonlySet<string>
): BasingKey {
  if (homeRegionOf(countryId) === region) return "home";

  const locals = countriesInRegion(region);
  if (locals.some((c) => atWarWith.has(c))) return "hostile";
  if (locals.some((c) => c === countryId || sharesBloc(blocs, countryId, c))) return "allied";
  return "neutral";
}

/**
 * Berths available to a country in a region.
 *
 * Two terms, deliberately different. Somebody else's harbour is available to you on
 * somebody else's terms, so the region's own port rating is scaled by your basing status
 * there. Forward works you built yourself count at full value, because a tender and a
 * fuel barge do not care whose flag flies over the headland.
 */
export function berthCapacity(region: RegionCode, status: BasingKey, ownPortWorks: number): number {
  const port = M.region(region)?.port ?? 0;
  const factor = (R.BASING_FACTOR as Record<string, number>)[status] ?? 0;
  return port * factor + ownPortWorks;
}

/** Logistical footprint a country's formations are asking of a region. */
export function berthDemand(units: readonly NavairUnit[]): number {
  return sum(
    units.filter((u) => u.domain === "naval"),
    (u) => berthCostOf(u.type)
  );
}

/**
 * Supply ceiling lost to overcrowding.
 *
 * Only demand ABOVE capacity costs anything, so a fleet that fits pays nothing and the
 * penalty grows with how badly it does not fit.
 */
export function overcrowdPenalty(demand: number, capacity: number): number {
  return Math.max(0, demand - capacity) * R.OVERCROWD_PENALTY;
}

/**
 * The supply level a formation can reach at its station.
 *
 * Distance from home, the region's own logistics difficulty, and overcrowding all pull it
 * down; airlift pulls it back up. Floored at `MIN_SUPPLY` so a formation deep in hostile
 * water is crippled rather than annihilated by bookkeeping.
 */
export function supplyCeiling(
  unit: NavairUnit,
  status: BasingKey,
  overcrowding: number,
  airliftActive: boolean
): number {
  const station = unit.station;
  if (!station) return 100;

  const home = homeRegionOf(unit.countryId);
  const hops = home ? M.distance(home, station) : 0;
  const hopCost = Number.isFinite(hops) ? hops * R.SUPPLY_PER_HOP : R.SUPPLY_PER_HOP * 4;

  const logi = M.region(station)?.logi ?? "Medium";
  const logiCost = (R.LOGI_PENALTY as Record<string, number>)[logi] ?? 0;

  // A hostile coast is not merely far away, it is actively unhelpful.
  const hostilePenalty = status === "hostile" ? R.SUPPLY_PER_HOP : 0;

  const lift = airliftActive ? R.AIRLIFT_SUPPLY_BONUS : 0;

  return clamp(100 - hopCost - logiCost - overcrowding - hostilePenalty + lift, R.MIN_SUPPLY, 100);
}
