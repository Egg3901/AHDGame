import type { BillLifecycleConfig } from "../types";

const VOTING_HOURS = 24;
const PRESIDENT_HOURS = 10;
// Override window is set at veto time by the presidential-action endpoint, not by
// the engine; this value is informational for the override stage.
const OVERRIDE_HOURS = 24;

/**
 * US Congress national lifecycle: house/senate (or joint) origin vote → second
 * chamber → presidential action window (pocket-sign on timeout) → veto override
 * (2/3 of the SEATS in each chamber). Reproduces the phase graph previously
 * hard-coded in billLifecycle.ts phases A/D/E/F/G.
 */
export const US_NATIONAL_CONFIG: BillLifecycleConfig = {
  country: "US",
  level: "national",
  originChambers: ["house", "senate", "joint"],
  activateProposed: true,
  flags: { jointSkipsSecondChamber: true },
  stages: [
    {
      kind: "chamberVote",
      status: "active",
      voteField: "votes",
      officeTypeFor: (b) => (b.currentChamber === "joint" ? "house" : b.currentChamber),
      // The evaluator applies the nat/priv two-thirds supersede and the Senate
      // filibuster cloture check internally, matching billLifecycle.ts.
      passRule: "filibusterCloture",
      onReject: "fail",
      onPassStatus: "active_other", // joint bills short-circuit to "enrolled" via the flag
      votingDurationHours: VOTING_HOURS,
    },
    {
      kind: "chamberVote",
      status: "active_other",
      voteField: "otherChamberVotes",
      officeTypeFor: (b) => (b.currentChamber === "joint" ? "house" : b.currentChamber),
      passRule: "filibusterCloture",
      onReject: "fail",
      onPassStatus: "enrolled",
      votingDurationHours: VOTING_HOURS,
      // Intl-org bills skip the President and enact directly (billRequiresExecutiveAction).
      execActionCheckOnPass: true,
    },
    {
      kind: "executiveAction",
      status: "enrolled",
      execKind: "presidentVeto",
      officeType: "president",
      windowHours: PRESIDENT_HOURS,
      onTimeout: "sign", // pocket-sign
    },
    {
      kind: "override",
      status: "veto_override",
      threshold: "twoThirdsSeats",
      chambers: ["house", "senate"],
      votingDurationHours: OVERRIDE_HOURS,
    },
  ],
};
