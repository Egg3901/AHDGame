/**
 * Merger geography requires two actual party footprints to overlap or touch.
 * hasMergeAdjacency uses one adjacency hop, not overlapping expanded frontiers;
 * an empty footprint cannot establish adjacency.
 */
export function hasMergeAdjacency(
  source: ReadonlySet<string>,
  target: ReadonlySet<string>,
  adjacency: Readonly<Record<string, readonly string[]>>
): boolean {
  for (const region of source) {
    if (target.has(region)) return true;
    if ((adjacency[region] ?? []).some((neighbor) => target.has(neighbor))) return true;
  }
  return false;
}
