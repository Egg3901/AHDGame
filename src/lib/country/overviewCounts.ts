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
}
