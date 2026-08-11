/** A single region as a nation map lists it — derived live from `states`. */
export interface MapRegionRosterEntry {
  /** Region code (= states._id). */
  id: string;
  name: string;
  /** Lower-chamber direct mandates / seats. */
  seats: number;
  /** Province / regional grouping label. */
  grouping: string;
  /** Population (for the econ-only region list). */
  population: number;
  /**
   * US only: false for unadmitted territories (Alaska/Hawaii under 1953) and
   * non-electoral districts (DC). Omitted / true elsewhere. The nation map
   * renders only political regions so earlier eras show 48 states, not 50.
   */
  political?: boolean;
}

/** The subset of a `states` doc the roster needs (matches the route's projection). */
export interface RosterStateInput {
  _id: string;
  name?: string;
  houseDistricts?: number;
  region?: string;
  population?: number;
}

/**
 * Build a nation map's region roster from the country's live owned `states`. The
 * roster — not a static seed bundle — drives which regions the map lists, their
 * names, and seat counts, so a region transferred between countries carries its
 * own metadata onto the new owner's map. Sorted by name for stable display.
 */
export function buildRegionRoster(states: RosterStateInput[]): MapRegionRosterEntry[] {
  return states
    .map((s) => ({
      id: String(s._id),
      name: s.name ?? String(s._id),
      seats: s.houseDistricts ?? 0,
      grouping: s.region ?? "",
      population: s.population ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Keep only US regions that currently host state politics (era apportionment +
 * mid-game admissions). Unadmitted territories stay in `states` for economy /
 * statehood admission but must not appear on the nation map as empty states.
 */
export function filterPoliticalUsRoster(
  regions: readonly MapRegionRosterEntry[],
  politicalIds: ReadonlySet<string>
): MapRegionRosterEntry[] {
  return regions.filter((r) => politicalIds.has(r.id)).map((r) => ({ ...r, political: true }));
}
