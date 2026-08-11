/**
 * Curated catalog of **agency funding programmes** — the signature flagship
 * mechanic of a `political`-category organization. Members vote (a `fund_agency`
 * resolution) to stand up a global programme; on passage a fixed cost is drawn
 * from the org's pooled fund (member dues) and, while funded, the programme
 * applies a bounded member-wide metric benefit for a duration.
 *
 * This makes the pooled fund a real political instrument: dues pay for global
 * programmes that lift every member, competing with aid for the same treasury.
 * The metric effect rides the same `targetNudges` seam as directives/posture
 * (bounded, node-backed). Underfunded programmes simply don't take effect.
 */

export interface AgencyDef {
  /** Stable key stored on the resolution (`agencyKey`). */
  key: string;
  label: string;
  /** Bare registry metricId the programme nudges member-wide (node-backed). */
  metricId: string;
  /** Signed, bounded target nudge applied to every member while funded. */
  delta: number;
  /** One-time cost drawn from the pooled fund on passage (USD). */
  costUsd: number;
  blurb: string;
}

export const AGENCY_CATALOG: AgencyDef[] = [
  {
    key: "humanitarian_relief",
    label: "Humanitarian Relief Agency",
    metricId: "socialCohesion",
    delta: 2,
    costUsd: 40_000_000,
    blurb: "Disaster and refugee relief across members strengthens social cohesion.",
  },
  {
    key: "development_programme",
    label: "Development Programme",
    metricId: "incomeInequality",
    delta: -2,
    costUsd: 50_000_000,
    blurb: "Member-wide development programmes compress income inequality.",
  },
  {
    key: "climate_fund",
    label: "Climate Fund",
    metricId: "carbonEmissions",
    delta: -1.5,
    costUsd: 40_000_000,
    blurb: "Pooled climate financing cuts member carbon emissions.",
  },
  {
    key: "cultural_programme",
    label: "Cultural & Education Programme",
    metricId: "civilLiberties",
    delta: 1.5,
    costUsd: 30_000_000,
    blurb: "Cultural exchange and education programmes broaden civil liberties.",
  },
];

const AGENCY_BY_KEY = new Map<string, AgencyDef>(AGENCY_CATALOG.map((a) => [a.key, a]));

/** Look up an agency definition by its stored key, or undefined if unknown. */
export function getAgencyDef(key: string | undefined): AgencyDef | undefined {
  return key == null ? undefined : AGENCY_BY_KEY.get(key);
}

/** True if `key` names a known agency in the catalog. */
export function isAgencyKey(key: string): boolean {
  return AGENCY_BY_KEY.has(key);
}

/** Turns a funded agency programme stays active before it lapses (48 ≈ 1 year). */
export const AGENCY_FUNDING_DURATION_TURNS = 48;
