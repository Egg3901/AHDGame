import type { CountryReadinessExpectations } from "@/lib/constants/countryReadinessExpectations";
import { checkGovernmentFormation } from "@/lib/constants/readinessChecks";

/**
 * What a fully seeded Japan looks like, for the admin readiness audit.
 *
 * Moved out of `src/lib/constants/countryReadinessExpectations.ts`, which now
 * forwards to this. Values unchanged.
 *
 * ⚠ THESE ARE FLOORS, NOT TARGETS. Every `*Min` is a lower bound: seeding
 * more than the number is fine, seeding fewer is the finding. `seatMin` is the
 * one DERIVED value -- 713 is 465 Shugiin + 248 Sangiin -- so if the seat tables
 * in `constants/states.ts` change and this does not follow, the audit happily
 * passes a Diet of the wrong size. `japanReachable.test.ts` asserts the two
 * agree, which is the only thing keeping them honest.
 *
 * ⚠ `legislationTypesMin: 0` IS DELIBERATE. Japan seeds no bespoke
 * legislation types and runs on the shared catalogue, so any non-zero floor here
 * reports a permanent false failure.
 */
export const JP_READINESS_EXPECTATIONS: CountryReadinessExpectations = {
  regionCount: 47,
  partyMin: 5,
  partyRoster: "LDP, CDP, Komeito, JIP, JCP",
  // ⚠ SCALED TO THE 8 PLANNING REGIONS, NOT THE 47 PREFECTURES. This read 235,
  // which is 47 x 5 -- a prefecture-scale figure. `statePartyOrg` is a
  // (region, party) grid over the regions actually seeded, and Japan seeds the 8
  // planning regions, so a COMPLETE grid is 8 x 6 = 48. The old floor could not
  // be reached by a correct seed.
  //
  // `regionCount` above escapes this because `getReadinessExpectations` rewrites
  // it from the era's authored region bundle; `statePartyOrgMin` is not
  // era-derived, so it has to be written at the right scale by hand. 8 x the
  // `partyMin` of 5 is the floor a complete grid always clears.
  statePartyOrgMin: 40,
  seatMin: 713,
  seatNote: "Expected ≥713 (465 Shugiin + 248 Sangiin)",
  // ⚠ A BLOC COUNT, NOT A SEAT COUNT. This read 700, as if the Diet's 713
  // seats were 713 individually-seeded politicians. An `electedOfficials` row is
  // one (region, party) bloc carrying `seatsHeld` and referencing ONE npp, so a
  // fully seeded Diet is ~192 rows and ~211 NPPs. The old floor could not be met
  // by a correct seed and warned on every reset. Germany (200) and China (70)
  // were already written against blocs.
  //
  // Set well under the observed count deliberately: the floor is here to catch a
  // seed that produced nothing, and the bloc count falls in sparser eras.
  nppMin: 100,
  nppNote: "Expected ≥100 Diet party blocs (one NPP each, not one per seat)",
  officialMin: 700,
  demographicsCount: 47,
  stateMetricsFilter: { countryId: "JP" },
  stateMetricsCount: 47,
  legislationTypesMin: 0,
  extras: [(db) => checkGovernmentFormation("JP", db)],
};
