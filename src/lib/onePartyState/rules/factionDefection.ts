/** Faction defection ranks actors by divergence, retaining stable input ties. */
export function pickDefectors<T extends { divergence: number }>(officials: T[]): T[] {
  const target = Math.min(officials.length, Math.max(3, Math.ceil(officials.length * 0.15)));
  return officials
    .map((official, index) => ({ official, index }))
    .sort((a, b) => b.official.divergence - a.official.divergence || a.index - b.index)
    .slice(0, target)
    .map(({ official }) => official);
}
