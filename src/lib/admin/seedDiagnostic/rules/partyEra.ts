/**
 * Pure era check for persisted default parties. A default party whose name is
 * not in the effective roster authored for the preset is a wrong-era row:
 * dissolved, renamed, or tagged for another preset (#2294).
 */
export interface PersistedDefaultParty {
  countryId: string;
  name: string;
}

export function wrongEraDefaultParties(
  persisted: readonly PersistedDefaultParty[],
  effectiveRosterNames: ReadonlyMap<string, ReadonlySet<string>>
): PersistedDefaultParty[] {
  return persisted.filter((party) => {
    const roster = effectiveRosterNames.get(party.countryId);
    return roster !== undefined && !roster.has(party.name);
  });
}
