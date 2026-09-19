/**
 * January 2027 congressional composition target.
 *
 * The 2026 election had not occurred when this seed was authored. These are
 * projections, not historical results. The snapshot is frozen to Call the
 * Map's September 9, 2026 median outcomes, following the product assumption
 * that the polling averages hold through election day.
 *
 * House source: https://www.callthemap.com/house
 * Senate source: https://www.callthemap.com/senate
 *
 * Do not silently refresh these numbers. A later projection snapshot or the
 * certified result must update the source date and the roster data together.
 */

export const US_CONGRESS_PROJECTION_2027 = {
  snapshotDate: "2026-09-09",
  basis: "polling-average median projection",
  house: {
    democrat: 228,
    republican: 207,
  },
  senate: {
    democraticAligned: 50,
    republican: 50,
    controllingParty: "republican",
    controlBasis: "vice-presidential tie-break",
  },
} as const;
