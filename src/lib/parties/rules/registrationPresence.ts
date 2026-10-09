/**
 * Registration drives require a local player, active NPP or regional officeholder.
 * buildRegistrationPresence uses current rosters, not cached presence or Org.
 * Missing legacy country IDs are accepted only in an unambiguous region.
 */
export interface RegistrationRegion {
  countryId: string;
  stateId: string;
}

interface MemberPresence {
  countryId?: string;
  party?: string;
  homeState?: string;
  retiredAt?: unknown;
}

interface OfficialPresence {
  countryId?: string;
  party?: string;
  state?: string;
}

export function registrationPresenceKey(country: string, party: string, region: string): string {
  return JSON.stringify([country, party, region]);
}

export function buildRegistrationPresence(
  regions: readonly RegistrationRegion[],
  players: readonly MemberPresence[],
  npps: readonly MemberPresence[],
  officials: readonly OfficialPresence[]
): Set<string> {
  const countriesByRegion = new Map<string, Set<string>>();
  for (const region of regions) {
    const countries = countriesByRegion.get(region.stateId) ?? new Set<string>();
    countries.add(region.countryId);
    countriesByRegion.set(region.stateId, countries);
  }
  const presence = new Set<string>();
  const add = (country: string | undefined, party: string | undefined, region?: string) => {
    if (!region || !party || party === "independent") return;
    const countries = countriesByRegion.get(region);
    const resolved = country ?? (countries?.size === 1 ? [...countries][0] : undefined);
    if (resolved && countries?.has(resolved)) {
      presence.add(registrationPresenceKey(resolved, party, region));
    }
  };
  for (const row of players) add(row.countryId, row.party, row.homeState);
  for (const row of npps) {
    if (row.retiredAt == null) add(row.countryId, row.party, row.homeState);
  }
  for (const row of officials) add(row.countryId, row.party, row.state);
  return presence;
}
