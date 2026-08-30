import type { ElectionDetail } from "./ElectionDetailTypes";
import type { CountryId } from "@/lib/constants/countries";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";

const SENATE_CLASS_ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III" };

export const US_STATE_NAMES: Record<string, string> = {
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
  EAE: "East of England",
  EMI: "East Midlands",
  WMI: "West Midlands",
  YHU: "Yorkshire and the Humber",
  NWE: "North West England",
  NEE: "North East England",
  WAL: "Wales",
  SCO: "Scotland",
  NIR: "Northern Ireland",
};

/** Adjective form of UK region names for use in election titles. */
export const UK_REGION_DESCRIPTOR: Record<string, string> = {
  LON: "London",
  SEE: "South East England",
  SWE: "South West England",
  EAE: "East of England",
  EMI: "East Midlands",
  WMI: "West Midlands",
  YHU: "Yorkshire and the Humber",
  NWE: "North West England",
  NEE: "North East England",
  WAL: "Welsh",
  SCO: "Scottish",
  NIR: "Northern Irish",
};

export function electionTitle(e: ElectionDetail): string {
  const seatsSuffix = e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : "";
  // Chamber types compose "{authority label} Race" — country-aware + de-prefixed
  // (US "House", NG "House of Representatives" / "State House of Assembly").
  if (e.electionType === "senate") {
    const cls = e.senateClass
      ? ` (Class ${SENATE_CLASS_ROMAN[e.senateClass] ?? e.senateClass})`
      : "";
    return `${formatElectionTypeLabel("senate", e.countryId as CountryId)} Race${cls}`;
  }
  if (
    e.electionType === "house" ||
    e.electionType === "stateSenate" ||
    e.electionType === "regionalCouncil"
  ) {
    return `${formatElectionTypeLabel(e.electionType, e.countryId as CountryId)} Race${seatsSuffix}`;
  }
  switch (e.electionType) {
    case "governor":
      return "Gubernatorial Race";
    case "president":
      return "Presidential Race";
    case "commons": {
      const descriptor = UK_REGION_DESCRIPTOR[e.state] ?? US_STATE_NAMES[e.state] ?? e.state;
      const seats = e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : "";
      return `${descriptor} Parliamentary Race${seats}`;
    }
    case "primeMinister":
      return "Prime Minister Race";
    case "shugiin":
      return `Shūgiin Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    case "sangiin":
      return `Sangiin Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    case "bundestag":
      return `Bundestag Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    case "landtag":
      return `Landtag Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    case "ministerPresident":
      return "Minister-President Race";
    case "chancellor":
      return "Chancellor Race";
    case "npcDelegate":
      return `NPC Delegate Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    case "peoplesCongress":
      return `People's Congress Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    case "dail":
      return `Dáil Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    case "seanad":
      return `Seanad Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    case "uachtaran":
      return "Uachtarán Race";
    case "localCouncil":
      return `Local Council Race${e.totalSeats && e.totalSeats > 1 ? ` · ${e.totalSeats} seats` : ""}`;
    default:
      // Every other chamber (soviets, eastern-bloc assemblies, the beta
      // parliaments) reads its label from the country-aware map instead of
      // leaking the raw type key ("supremeSoviet") into the page title.
      return `${formatElectionTypeLabel(e.electionType, e.countryId as CountryId)} Race${seatsSuffix}`;
  }
}

/**
 * The page title for an election detail view. National races (president,
 * commons, uachtarán) carry no state prefix; everything else is prefixed with
 * the state/region name. Single source of truth — the header, the breadcrumb
 * and the route metadata all read from here.
 */
export function electionPageTitle(e: ElectionDetail, electionYear: number | null): string {
  const national = ["president", "commons", "uachtaran"].includes(e.electionType);
  if (national) return `${electionYear} ${electionTitle(e)}`;
  return `${electionYear} ${US_STATE_NAMES[e.state] ?? e.regionName ?? e.state} ${electionTitle(e)}`;
}

export function scoreColor(score: number) {
  if (score >= 70) return "text-success";
  if (score >= 50) return "text-warning";
  if (score >= 30) return "text-warning/70";
  return "text-error";
}

export function PhaseTag({
  inPrimary,
  isEnded,
  isUpcoming,
}: {
  inPrimary: boolean;
  isEnded: boolean;
  isUpcoming?: boolean;
}) {
  if (isEnded)
    return (
      <span className="rounded-full border border-card-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-muted">
        Completed
      </span>
    );
  if (isUpcoming)
    return (
      <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400">
        Upcoming
      </span>
    );
  if (inPrimary)
    return (
      <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
        Primary Phase
      </span>
    );
  return (
    <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
      General Election
    </span>
  );
}

export function formatVotes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}
