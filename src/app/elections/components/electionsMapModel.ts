import type { ElectionDisplay } from "@/lib/db/types";
import { getMappableRegions, type RegionMapData } from "@/components/CountryMapPaths";
import { isCompetitiveElection, leaderColor } from "../electionsHelpers";

export interface MapRegionGroup {
  stateId: string;
  elections: ElectionDisplay[];
}

export interface ElectionFilterOptions {
  /** "" = all races; "senate-N" selects a single senate class. */
  race: string;
  hideUpcoming: boolean;
  competitive: boolean;
  /**
   * Primary stage. "" = no constraint, "in" = races currently in their primary,
   * "out" = races that are not. Filing and primary voting close before the
   * general, so which side of that line a race sits on decides whether a player
   * can still get on the ballot.
   */
  primary?: "" | "in" | "out";
  /**
   * Field size. "" = no constraint, "uncontested" = no declared candidate at
   * all or a single one running unopposed, "contested" = two or more. The open
   * seats are what a player scanning for somewhere to run is looking for.
   */
  contest?: "" | "uncontested" | "contested";
}

/** A race nobody has to beat: zero or one declared candidate. */
export function isUncontestedElection(e: ElectionDisplay): boolean {
  return (e.candidates?.length ?? 0) <= 1;
}

/**
 * Every filter EXCEPT the region one.
 *
 * The map must read from this rather than from a region-filtered list: it is a
 * country-wide overview, and narrowing its input to the selected region is what
 * collapsed it to a single state.
 */
export function filterElections(
  elections: ElectionDisplay[],
  { race, hideUpcoming, competitive, primary, contest }: ElectionFilterOptions
): ElectionDisplay[] {
  return elections.filter((e) => {
    if (race) {
      if (race.startsWith("senate-")) {
        const cls = Number.parseInt(race.slice("senate-".length), 10);
        if (e.electionType !== "senate" || e.senateClass !== cls) return false;
      } else if (e.electionType !== race) {
        return false;
      }
    }
    if (hideUpcoming && e.status === "upcoming") return false;
    if (competitive && e.electionType !== "president" && !isCompetitiveElection(e)) return false;
    if (primary === "in" && !e.inPrimary) return false;
    if (primary === "out" && e.inPrimary) return false;
    if (contest === "uncontested" && !isUncontestedElection(e)) return false;
    if (contest === "contested" && isUncontestedElection(e)) return false;
    return true;
  });
}

/**
 * Narrow to one region. Presidential elections use state "US" and are exempt,
 * so they stay visible while a region is selected.
 */
export function filterByRegion(elections: ElectionDisplay[], region: string): ElectionDisplay[] {
  if (!region) return elections;
  return elections.filter((e) => e.state === region || e.electionType === "president");
}

/** Group elections by region, dropping empties and floating the national group first. */
export function buildRegionGroups(
  regionIds: string[],
  elections: ElectionDisplay[]
): MapRegionGroup[] {
  return regionIds
    .map((stateId) => ({ stateId, elections: elections.filter((e) => e.state === stateId) }))
    .filter((g) => g.elections.length > 0)
    .sort((a, b) => (a.stateId === "US" ? -1 : b.stateId === "US" ? 1 : 0));
}

export interface ElectionSelection {
  /** Filtered AND region-narrowed — what the list and header counts read. */
  listElections: ElectionDisplay[];
  /** Region-scoped groups for the list. */
  listGroups: MapRegionGroup[];
  /** Country-wide groups for the map — never narrowed to the selected region. */
  mapGroups: MapRegionGroup[];
}

/**
 * Derives both groupings from one call.
 *
 * The map and the list need *different* inputs — the map is country-wide while
 * the list honors the region filter. Deriving them separately at the call site
 * is how the map ended up reading region-filtered data and collapsing to a
 * single state, so this returns both and leaves callers no way to pair the
 * wrong list with the map.
 */
export function selectElectionGroups(
  elections: ElectionDisplay[],
  regionIds: string[],
  filters: ElectionFilterOptions & { region: string }
): ElectionSelection {
  const anyRegion = filterElections(elections, filters);
  const listElections = filterByRegion(anyRegion, filters.region);

  return {
    listElections,
    mapGroups: buildRegionGroups(regionIds, anyRegion),
    listGroups: buildRegionGroups(
      regionIds.filter((r) => !filters.region || r === filters.region),
      listElections
    ),
  };
}

/**
 * Whether the map view can render for this country + race.
 *
 * Data-driven on purpose: no per-country race allowlist to maintain. National
 * races (president, state "US") fall out because "US" is not a mappable region
 * id, and countries without geometry (NG, BR, …) fall out because their region
 * set is empty.
 */
export function isMapAvailable(
  countryId: string,
  filterRace: string,
  groups: MapRegionGroup[]
): boolean {
  if (!filterRace) return false;
  const regions = getMappableRegions(countryId);
  if (regions.size === 0) return false;
  return groups.some((g) => g.elections.length > 0 && regions.has(g.stateId));
}

/** Display strings the tooltip needs; the render site passes translations. */
export interface MapTooltipLabels {
  uncontested: string;
  stateSenateShort: string;
}

const DEFAULT_TOOLTIP_LABELS: MapTooltipLabels = {
  uncontested: "Uncontested",
  stateSenateShort: "State Sen",
};

function raceLabel(electionType: string, labels: MapTooltipLabels): string {
  if (electionType === "stateSenate") return labels.stateSenateShort;
  return electionType.charAt(0).toUpperCase() + electionType.slice(1);
}

/** Color/label/tooltip per region. Input is already race-filtered by the caller. */
export function buildRegionMapData(
  groups: MapRegionGroup[],
  labels: MapTooltipLabels = DEFAULT_TOOLTIP_LABELS
): Record<string, RegionMapData> {
  const result: Record<string, RegionMapData> = {};

  for (const { stateId, elections } of groups) {
    if (elections.length === 0) continue;
    const best = elections.find((e) => e.polling?.leaderId) ?? elections[0];

    result[stateId] = {
      color: leaderColor(best),
      label: stateId,
      tooltip: elections.map((el) => {
        const p = el.polling;
        const leader = p?.leaderName ?? labels.uncontested;
        const pct = p?.leaderId ? ` ${(p.sharesPct[p.leaderId] ?? 0).toFixed(1)}%` : "";
        const comp = isCompetitiveElection(el) ? " ⚡" : "";
        return `${raceLabel(el.electionType, labels)}: ${leader}${pct}${comp}`;
      }),
    };
  }

  return result;
}

export interface LegendEntry {
  partyId: string;
  name: string;
  color: string;
  /** How many regions this party leads — drives ordering. */
  regions: number;
}

/**
 * Legend entries derived from who is actually leading, so non-US maps don't
 * get a US-party legend.
 */
export function buildLegend(groups: MapRegionGroup[]): {
  parties: LegendEntry[];
  hasUnpolled: boolean;
} {
  const byParty = new Map<string, LegendEntry>();
  let hasUnpolled = false;

  for (const { elections } of groups) {
    if (elections.length === 0) continue;
    const best = elections.find((e) => e.polling?.leaderId) ?? elections[0];
    const polling = best.polling;
    const leaderId = polling?.leaderId;

    if (!polling || !leaderId) {
      hasUnpolled = true;
      continue;
    }

    const partyId = polling.candidateParties?.[leaderId] ?? "unknown";
    const existing = byParty.get(partyId);
    if (existing) {
      existing.regions += 1;
      continue;
    }
    byParty.set(partyId, {
      partyId,
      name: polling.candidatePartyNames?.[leaderId] ?? partyId,
      color: polling.candidatePartyColors?.[leaderId] ?? "var(--muted)",
      regions: 1,
    });
  }

  const parties = [...byParty.values()].sort(
    (a, b) => b.regions - a.regions || a.name.localeCompare(b.name)
  );

  return { parties, hasUnpolled };
}
