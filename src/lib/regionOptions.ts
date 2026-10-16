/**
 * One ordering rule for every state / region / province dropdown: alphabetical
 * by the label the player actually reads, never by id, region group or seed order.
 */
const labelCollator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Compare two display labels using the shared state/region ordering. */
export function compareRegionLabels(left: string, right: string): number {
  return labelCollator.compare(left, right);
}

/** Return a new array sorted alphabetically by `getLabel`. Does not mutate the input. */
export function sortByRegionLabel<T>(items: readonly T[], getLabel: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareRegionLabels(getLabel(a), getLabel(b)));
}
