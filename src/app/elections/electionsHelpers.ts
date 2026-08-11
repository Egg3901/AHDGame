import { electionToLarpYear } from "@/lib/utils/formatters";
import { electionRegionUrl } from "@/lib/urls";
import type { ElectionDisplay } from "@/lib/db/types";

export type ElectionType =
  "senate" | "house" | "stateSenate" | "governor" | "president" | "commons" | "primeMinister";

export function leaderColor(election: ElectionDisplay): string {
  const leaderId = election.polling?.leaderId;
  if (!leaderId) return "var(--muted)";
  return election.polling?.candidatePartyColors?.[leaderId] ?? "var(--muted)";
}

/** Human-readable phase label for an election. */
export function getPhaseLabel(status: string, inPrimary: boolean): string {
  if (status === "upcoming") return "Upcoming";
  if (status === "completed") return "Completed";
  if (status === "active") return inPrimary ? "Primary" : "General";
  return status;
}

/** Badge CSS for each phase. */
export function getPhaseBadgeClass(status: string, inPrimary: boolean): string {
  if (status === "upcoming") return "bg-info/10 border-info/25 text-info";
  if (status === "active" && inPrimary) return "bg-warning/10 border-warning/25 text-warning";
  if (status === "active" && !inPrimary) return "bg-success/10 border-success/25 text-success";
  return "bg-muted/10 border-muted/25 text-muted";
}

/**
 * Bespoke race-title phrasings that are NOT `${label} Race` (governor →
 * "Gubernatorial", president → "Presidential", etc.). Chamber types
 * (senate/house/stateSenate) are composed from the shared label authority
 * instead — see ElectionCard — so they stay country-aware and de-prefixed.
 */
export const ELECTION_RACE_LABELS: Record<string, string> = {
  governor: "Gubernatorial Race",
  president: "Presidential Race",
  commons: "Parliament (Commons) Race",
  primeMinister: "Prime Minister Race",
};

export const SENATE_CLASS_ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III" };

export const ELECTION_STATE_NAMES: Record<string, string> = {
  US: "National",
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  // UK Regions
  LON: "London",
  SEE: "South East England",
  SWE: "South West England",
  EMI: "East Midlands",
  WMI: "West Midlands",
  YHU: "Yorkshire and the Humber",
  NWE: "North West England",
  NEE: "North East England",
  WAL: "Wales",
  SCO: "Scotland",
  NIR: "Northern Ireland",
  EAE: "East of England",
};

/**
 * Compute the LARP election year from election metadata (type, cycle, class).
 *
 * Prefer `resolveElectionYear(election)` when an Election doc is in hand —
 * that path uses the doc's baked `electionYear` and only falls back to cycle
 * math for legacy/un-backfilled rows. This helper is retained for callers
 * that only have positional pieces of the doc.
 */
export function electionGameYearFromState(
  electionType: string,
  cycle: number,
  senateClass?: number | null,
  chamberClass?: number | null
): number {
  return electionToLarpYear(electionType, cycle, senateClass, chamberClass);
}

export function isCompetitiveElection(e: ElectionDisplay): boolean {
  const pcts = Object.values(e.polling?.sharesPct ?? {});
  if (pcts.length < 2) return false;
  const sorted = [...pcts].sort((a, b) => b - a);
  return sorted[0] - sorted[1] <= 15;
}

/**
 * Builds an election detail page URL, using seatId if available.
 * For elections with seatId, navigates to `/elections/{seatId}` (most relevant cycle).
 * Falls back to `/elections/{id}` (ObjectId) for legacy elections.
 */
export function buildElectionHref(election: { id: string; seatId?: string }): string {
  return `/elections/${election.seatId ?? election.id}`;
}

/**
 * Builds an election state detail page URL (county/CD results).
 * Uses seatId for the election path when available.
 */
export function buildElectionStateHref(
  election: { id: string; seatId?: string },
  countryId: string,
  stateId: string
): string {
  return electionRegionUrl(election.seatId ?? election.id, countryId, stateId);
}
