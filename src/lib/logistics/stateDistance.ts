/**
 * Interstate hop distance over the geographic adjacency map.
 *
 * Hop count is the freight-distance metric for the landed-price sourcing pass
 * (see the interstate-logistics plan, Rev 4): same state = 0, one state-line
 * crossing = 1, and so on. BFS over `STATE_ADJACENCY`, which is static, so the
 * per-country all-pairs result is computed once per process and cached.
 *
 * Unreachable pairs (e.g. HI, which has no adjacencies) return `null` — the
 * sourcing pass treats those as sea-freight legs rather than infinite cost.
 */

import type { CountryId } from "@/lib/constants/countries";
import { STATE_ADJACENCY, adjacentStates } from "@/lib/constants/stateAdjacency";

/** country → origin state → destination state → hops. Lazily built per country. */
const hopCache = new Map<CountryId, Map<string, Map<string, number>>>();

function bfsFrom(country: CountryId, origin: string): Map<string, number> {
  const dist = new Map<string, number>([[origin, 0]]);
  const queue: string[] = [origin];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const next of adjacentStates(country, cur)) {
      if (dist.has(next)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return dist;
}

function countryHops(country: CountryId): Map<string, Map<string, number>> {
  let byOrigin = hopCache.get(country);
  if (!byOrigin) {
    byOrigin = new Map();
    const adjacency = STATE_ADJACENCY[country];
    if (adjacency) {
      for (const origin of Object.keys(adjacency)) {
        byOrigin.set(origin, bfsFrom(country, origin));
      }
    }
    hopCache.set(country, byOrigin);
  }
  return byOrigin;
}

/**
 * State-line crossings between two states of the same country, or `null` when
 * either state is unknown or no land/sea-edge route exists between them.
 */
export function stateHops(country: CountryId, from: string, to: string): number | null {
  if (from === to) return 0;
  const hops = countryHops(country).get(from)?.get(to);
  return hops === undefined ? null : hops;
}
