/**
 * Connected party territory is preserved when a party grows or relocates.
 * Existing disconnected areas may heal, but a surviving area cannot be split
 * or replaced with a detached foothold: see preservesPartyTerritory.
 */
export type TerritoryAdjacency = Readonly<Record<string, readonly string[]>>;

export function territoryComponents(
  states: Iterable<string>,
  adjacency: TerritoryAdjacency
): Set<string>[] {
  const all = [...states];
  // Explicit isolated regions remain exempt, as in the growth frontier. They
  // must not become a universal bridge connecting otherwise disjoint areas.
  const remaining = new Set(all.filter((state) => adjacency[state]?.length !== 0));
  const components: Set<string>[] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value!;
    const component = new Set([first]);
    const queue = [first];
    remaining.delete(first);
    for (const state of queue) {
      for (const other of remaining) {
        // Preserve the existing explicit-island frontier exception. Unknown
        // regions are NOT islands and do not acquire invented adjacency.
        if (adjacency[state]?.includes(other) || adjacency[other]?.includes(state)) {
          remaining.delete(other);
          component.add(other);
          queue.push(other);
        }
      }
    }
    components.push(component);
  }
  return components.length === 0 && all.length > 0 ? [new Set(all)] : components;
}

/** Minimum-spanning connection budget, measured in missing-region path steps.
 * This is a progress metric, not a claim to solve minimum Steiner territory.
 * Every allowed growth step strictly reduces it until all areas connect.
 */
export function territoryConnectionBudget(
  states: Iterable<string>,
  adjacency: TerritoryAdjacency
): number {
  const occupied = new Set(states);
  const areas = territoryComponents(occupied, adjacency);
  if (areas.length < 2) return 0;
  const nodes = Object.keys(adjacency).filter((state) => adjacency[state]?.length !== 0);
  const distances = areas.map((area) => {
    const distance = new Map(nodes.map((state) => [state, area.has(state) ? 0 : Infinity]));
    const unvisited = new Set(nodes);
    while (unvisited.size > 0) {
      let current: string | undefined;
      let best = Infinity;
      for (const state of unvisited) {
        if (distance.get(state)! < best) {
          best = distance.get(state)!;
          current = state;
        }
      }
      if (current === undefined) break;
      unvisited.delete(current);
      for (const other of unvisited) {
        if (adjacency[current]?.includes(other) || adjacency[other]?.includes(current)) {
          distance.set(other, Math.min(distance.get(other)!, best + (occupied.has(other) ? 0 : 1)));
        }
      }
    }
    return areas.map((target) =>
      Math.min(...[...target].map((state) => distance.get(state) ?? Infinity))
    );
  });
  const reached = new Set([0]);
  let budget = 0;
  while (reached.size < areas.length) {
    let next = -1;
    let best = Infinity;
    for (const source of reached) {
      for (let target = 0; target < areas.length; target++) {
        if (!reached.has(target) && distances[source][target] < best) {
          best = distances[source][target];
          next = target;
        }
      }
    }
    if (next === -1) return Infinity;
    reached.add(next);
    budget += best;
  }
  return budget;
}

export function preservesPartyTerritory(
  before: Iterable<string>,
  after: Iterable<string>,
  adjacency: TerritoryAdjacency
): boolean {
  const oldStates = new Set(before);
  const newStates = new Set(after);
  const previous = territoryComponents(oldStates, adjacency);
  const next = territoryComponents(newStates, adjacency);
  if (next.length <= 1) return true;
  if (next.length > previous.length) return false;
  // Component counts alone are insufficient: joining two old areas must not
  // buy permission to split a third one in the same move.
  if (
    previous.some((area) => next.filter((part) => [...part].some((s) => area.has(s))).length > 1)
  ) {
    return false;
  }
  if (!next.every((area) => previous.some((part) => [...area].some((s) => part.has(s)))))
    return false;
  const expanding = [...newStates].some((state) => !oldStates.has(state));
  if (!expanding) return true;
  return (
    territoryConnectionBudget(newStates, adjacency) <
    territoryConnectionBudget(oldStates, adjacency)
  );
}

/** Regions available for recruitment or joining, including recovery-only growth. */
export function connectedGrowthFrontier(
  presence: Iterable<string>,
  frontier: Iterable<string>,
  adjacency: TerritoryAdjacency
): Set<string> {
  const occupied = new Set(presence);
  if (territoryComponents(occupied, adjacency).length <= 1) return new Set(frontier);
  return new Set(
    [...frontier].filter(
      (state) =>
        occupied.has(state) ||
        preservesPartyTerritory(occupied, new Set([...occupied, state]), adjacency)
    )
  );
}
