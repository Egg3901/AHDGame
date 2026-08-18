/**
 * The two Cold War principals. Only these countries get a Conflicts entry on
 * their lander, and only when the subsystem is switched on: every other country
 * reaches the hub through the World nav instead.
 */
export const COLD_WAR_PRINCIPAL_IDS = ["US", "RU"] as const;

export function isColdWarPrincipal(countryId: string): boolean {
  return (COLD_WAR_PRINCIPAL_IDS as readonly string[]).includes(countryId);
}

/**
 * Response shape of GET /api/country/[code]/overview-counts — live figures
 * for the country lander's Explore directory. Every field is nullable; the
 * UI degrades a row to a plain chevron when its figure is missing.
 */
export interface OverviewCounts {
  parties: number | null;
  politicians: number | null;
  activeElections: number | null;
  upcomingElections: number | null;
  bills: number | null;
  regions: number | null;
  primeRate: number | null;
  /**
   * Command Economy v2 (P2): true when this country runs a flag-on planned
   * (command or dual-track) economy, so the Explore directory shows the
   * Command Economy dashboard link. Absent/false → the row stays hidden.
   */
  commandEconomy?: boolean;
  /** National GDP in millions, ready for `formatGDP`. */
  gdpMillions?: number | null;
  /** Budget balance as a share of GDP, in percent. Negative = deficit. */
  budgetBalancePctGdp?: number | null;
  /** Registered unions in this country. */
  unions?: number | null;
  /** Referendums currently campaigning. */
  activeReferendums?: number | null;
  /** Every referendum this country has ever run, so the row hides when there are none. */
  totalReferendums?: number | null;
  /**
   * Cold War readiness, present only when the Conflicts subsystem is switched on
   * and this country is a principal. Absent → the directory hides the row, which
   * is the same behaviour the navbar and the `/world/conflicts` gate use.
   */
  coldWarDefcon?: number | null;
}
