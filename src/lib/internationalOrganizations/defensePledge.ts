/**
 * Defense outlay as a percent of GDP, for the security-alliance 2% pledge.
 *
 * Playable countries use federal defense spending / GDP (same local units, so
 * the exchange rate cancels). Macro-tier members have no `federalBudget`; their
 * authored defense-sector share of aggregate capacity is the closest modelled
 * figure. Background nations have neither, and stay unrated.
 */

export function defenseSharePct(defense: number, gdp: number): number | undefined {
  if (!(gdp > 0) || !(defense > 0)) return undefined;
  return (defense / gdp) * 100;
}

export function defenseSharePctFromMacroSectors(
  sectors: Partial<Record<string, { capacity?: number }>> | undefined
): number | undefined {
  if (!sectors) return undefined;
  let total = 0;
  let defense = 0;
  for (const [key, sector] of Object.entries(sectors)) {
    const cap = sector?.capacity ?? 0;
    if (!(cap > 0)) continue;
    total += cap;
    if (key === "defense") defense += cap;
  }
  if (!(total > 0) || !(defense > 0)) return undefined;
  return (defense / total) * 100;
}
