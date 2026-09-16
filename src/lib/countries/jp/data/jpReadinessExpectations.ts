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
  statePartyOrgMin: 235,
  seatMin: 713,
  seatNote: "Expected ≥713 (465 Shugiin + 248 Sangiin)",
  nppMin: 700,
  nppNote: "Expected ≥700 Diet NPPs",
  officialMin: 700,
  demographicsCount: 47,
  stateMetricsFilter: { countryId: "JP" },
  stateMetricsCount: 47,
  legislationTypesMin: 0,
  extras: [(db) => checkGovernmentFormation("JP", db)],
};
