/**
 * Which Japanese parties seed as Major, and in which eras.
 *
 * Moved out of `src/lib/seeds/defaultPartyTiers.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠ AN ENTRY WITH NO `presets` APPLIES TO EVERY ERA. That is why the LDP
 * spells out six presets instead of omitting the field: it did not exist before
 * November 1955, so in `1953-default` the major conservative force is the
 * Liberal Party (RYO). Deleting the LDP preset list to "simplify" back-dates the
 * party two years and leaves 1953 with two major conservative parties.
 *
 * ⚠ THIS IS ONLY THE STARTING TIER. The `partyTierTurn` phase recomputes
 * tier from live Org every turn, so it sets the badge at game start and nothing
 * after that.
 */
export const JP_PARTY_TIERS: Array<{ abbr: string; presets?: string[] }> = [
  // LDP formed Nov 1955; in 1953 the Liberal Party (RYO) was the major conservative force.
  // LDP is Major for all eras except 1953-default.
  {
    abbr: "LDP",
    presets: [
      "1979-default",
      "1991-default",
      "1999-default",
      "2007-default",
      "2019-default",
      "2023-default",
    ],
  },
  { abbr: "RYO", presets: ["1953-default"] },
  { abbr: "JSP" },
  { abbr: "CDP" },
];
