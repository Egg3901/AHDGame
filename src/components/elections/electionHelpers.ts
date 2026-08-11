import { electionRegionUrl } from "@/lib/urls";
import { getRegionalBillAssentTitleForState, type CountryId } from "@/lib/constants/countries";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";

export function partyFallbackColor(partyId: string): string {
  if (partyId === "democrat") return "#3b82f6";
  if (partyId === "republican") return "#ef4444";
  return "#6b7280";
}

/** Lighten a hex color toward white by `factor` (0–1). */
export function lightenHex(hex: string, factor: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const nr = Math.round(Math.min(255, r + (255 - r) * factor));
  const ng = Math.round(Math.min(255, g + (255 - g) * factor));
  const nb = Math.round(Math.min(255, b + (255 - b) * factor));
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

// Static 2020 electoral vote allocation per state
export const STATE_EV: Record<string, number> = {
  AL: 9,
  AK: 3,
  AZ: 11,
  AR: 6,
  CA: 54,
  CO: 10,
  CT: 7,
  DE: 3,
  DC: 3,
  FL: 30,
  GA: 16,
  HI: 4,
  ID: 4,
  IL: 19,
  IN: 11,
  IA: 6,
  KS: 6,
  KY: 8,
  LA: 8,
  ME: 4,
  MD: 10,
  MA: 11,
  MI: 15,
  MN: 10,
  MS: 6,
  MO: 10,
  MT: 4,
  NE: 5,
  NV: 6,
  NH: 4,
  NJ: 14,
  NM: 5,
  NY: 28,
  NC: 16,
  ND: 3,
  OH: 17,
  OK: 7,
  OR: 8,
  PA: 19,
  RI: 4,
  SC: 9,
  SD: 3,
  TN: 11,
  TX: 40,
  UT: 6,
  VT: 3,
  VA: 13,
  WA: 12,
  WV: 4,
  WI: 10,
  WY: 3,
};

export const SENATE_CLASS_ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III" };

export function electionRaceTitle(
  election: {
    electionType: string;
    senateClass?: number | null;
    chamberClass?: number | null;
    totalSeats?: number | null;
    countryId?: string;
    state?: string | null;
  },
  year: number | null
): string {
  // IE / SCO / WAL recycle the cross-country `governor` officeType for a titled
  // sub-national executive — IE's Cathaoirleach (Lord Mayor of Dublin/Cork,
  // Mayor of Limerick/Galway), SCO's Provost, WAL's Leader. Dispatch through the
  // shared assent-title resolver so the race label matches what region pages
  // display. (US/UK/JP/CN keep the generic "Governor"; UK varies per region via
  // its own executive resolver and must not be folded in here.)
  const usesSubregionalGovernorTitle =
    election.electionType === "governor" &&
    (election.countryId === "IE" || election.countryId === "SCO" || election.countryId === "WAL");
  const base = usesSubregionalGovernorTitle
    ? getRegionalBillAssentTitleForState(election.countryId as CountryId, election.state ?? null)
    : formatElectionTypeLabel(election.electionType, election.countryId as CountryId | undefined);

  // US Senate: show class only (single-seat per class)
  if (election.electionType === "senate" && election.senateClass) {
    const classLabel = ` (Class ${SENATE_CLASS_ROMAN[election.senateClass] ?? election.senateClass})`;
    return `${year != null ? `${year} ` : ""}${base}${classLabel}`;
  }

  // JP Sangiin: show class AND seat count (multi-seat proportional)
  if (election.electionType === "sangiin" && election.chamberClass) {
    const classLabel = ` (Class ${SENATE_CLASS_ROMAN[election.chamberClass] ?? election.chamberClass})`;
    const seatsLabel =
      election.totalSeats && election.totalSeats > 1 ? ` · ${election.totalSeats} seats` : "";
    return `${year != null ? `${year} ` : ""}${base}${classLabel}${seatsLabel}`;
  }

  // Multi-seat elections: show seat count
  const seatsQualifier =
    (election.electionType === "house" ||
      election.electionType === "stateSenate" ||
      election.electionType === "commons" ||
      election.electionType === "snap_commons" ||
      election.electionType === "regionalCouncil" ||
      election.electionType === "shugiin" ||
      election.electionType === "snap_shugiin" ||
      election.electionType === "sangiin" ||
      election.electionType === "npcDelegate" ||
      election.electionType === "peoplesCongress") &&
    election.totalSeats &&
    election.totalSeats > 1
      ? ` · ${election.totalSeats} seats`
      : "";
  return `${year != null ? `${year} ` : ""}${base}${seatsQualifier}`;
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
