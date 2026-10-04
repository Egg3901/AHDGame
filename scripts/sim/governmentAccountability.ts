/** Deterministic paired mechanisms, using the production vote allocator. No database. */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { distributeVotesBySwingFlow } from "@/lib/electionEngine/voteDistributionSwingFlow";
import type { EnrichedCandidate, DistributeVotesOptions } from "@/lib/electionEngine/types";
import type { CountryId } from "@/lib/constants/countries";
import type {
  DemographicCategory,
  StateDemographics,
  StatePartyOrg,
  StateRegistrationPool,
} from "@/lib/db/types";
import { planStateRegDriftDecay } from "@/lib/turn/partyOrg/regDriftDecay";
import {
  accountabilityDrain,
  earnedOfficeholdingBonus,
  executiveIncumbencyBudget,
  responsibilityShares,
} from "@/lib/government/rules/accountability";
import { governmentApprovalFavorabilityDrain } from "@/lib/turn/rules/governmentApprovalFavorability";

const families: { country: CountryId; office: string; executive?: boolean }[] = [
  { country: "US", office: "senate" },
  { country: "US", office: "governor", executive: true },
  { country: "JP", office: "shugiin" },
  { country: "IE", office: "dail" },
  { country: "DE", office: "bundestag" },
  { country: "BR", office: "chamber" },
  { country: "SE", office: "riksdag" },
  { country: "FR", office: "assembly" },
];
const categories = [
  {
    _id: "ideology",
    name: "Ideology",
    groups: [
      { id: "left", defaultEconomicLean: -1.5, defaultSocialLean: -1, defaultTurnout: 60 },
      { id: "right", defaultEconomicLean: 1.5, defaultSocialLean: 1, defaultTurnout: 60 },
    ],
  },
] as DemographicCategory[];

function share(
  family: (typeof families)[number],
  approval: number,
  favorability: number,
  lean: number,
  mixed: boolean,
  baseline: boolean,
  partyIds = ["a", "b"]
): number {
  const candidates = [-1, 1].map((sign, i) => ({
    candidateId: String(i),
    party: partyIds[i],
    isNPP: !(mixed && i === 1),
    charEP: sign * 1.5,
    charSP: sign,
    partyEcon: sign * 1.5,
    partySocial: sign,
    favorability: i === 0 ? favorability : 60,
    politicalInfluence: 60,
    nationalInfluence: 60,
    support: 50,
    archetypeApprovals: {},
    infamy: 0,
  })) as EnrichedCandidate[];
  const demo = {
    _id: "TEST",
    countryId: family.country,
    categoryWeights: { ideology: 100 },
    groups: {
      left: { population: lean, turnout: 60, economicLean: -1.5, socialLean: -1 },
      right: { population: 100 - lean, turnout: 60, economicLean: 1.5, socialLean: 1 },
    },
  } as StateDemographics;
  const options: DistributeVotesOptions = {
    isGeneralElection: true,
    countryId: family.country,
    votingSystem: "rcv",
  };
  if (family.executive) {
    options.incumbentPartyId = partyIds[0];
    // The old capped drag is expressed as its equivalent approval budget in
    // the current allocator. This is a mechanism control, not an old-build replay.
    options.incumbentApproval = baseline ? Math.max(36, approval) : approval;
  } else if (family.office === "senate") {
    options.legislativeIncumbentPartyId = partyIds[0];
    options.legislativeIncumbentTenureTerms = 2;
  }
  const result = distributeVotesBySwingFlow(
    candidates,
    60000,
    60000,
    100000,
    demo,
    categories,
    new Map([
      [partyIds[0], 50],
      [partyIds[1], 50],
    ]),
    options
  );
  assert.ok(Object.values(result.votesPerCandidate).every((n) => n >= 0));
  assert.ok(Math.abs(Object.values(result.sharesPct).reduce((sum, n) => sum + n, 0) - 100) < 1e-6);
  return result.sharesPct["0"];
}

const rows = [];
for (const family of families)
  for (const mixed of [false, true])
    for (const lean of [50, 60, 70])
      for (const approval of [0, 20, 40, 50, 70])
        for (const priorTenure of [0, 768]) {
          let oldFav = 60,
            newFav = 60;
          for (let turn = 0; turn < 192; turn++) {
            oldFav = Math.max(0, oldFav - governmentApprovalFavorabilityDrain(approval));
            newFav = Math.max(0, newFav - accountabilityDrain(approval, 1, priorTenure + turn));
          }
          const before = share(family, approval, oldFav, lean, mixed, true);
          const after = share(family, approval, newFav, lean, mixed, false);
          const renamed = share(family, approval, newFav, lean, mixed, false, [
            "challenger-relabelled",
            "incumbent-relabelled",
          ]);
          assert.ok(Math.abs(after - renamed) < 1e-8, "Party labels must not affect allocation");
          if (approval >= 50)
            assert.ok(
              Math.abs(before - after) < 1e-8,
              "Successful government retains its performance treatment"
            );
          rows.push({
            country: family.country,
            office: family.office,
            actorMix: mixed ? "mixed" : "npp",
            lean,
            approval,
            priorTenure,
            controlFavorability: oldFav,
            treatmentFavorability: newFav,
            controlShare: before,
            treatmentShare: after,
          });
        }
const coalition = responsibilityShares({
  executiveParty: "a",
  coalitionParties: ["b"],
  seatsByParty: { a: 30, b: 30, c: 40 },
  chamberSize: 100,
});
assert.deepEqual(coalition, { a: 0.375, b: 0.375 });
const governor = families[1];
assert.ok(
  share(governor, 0, 60, 70, false, false) < share(governor, 30, 60, 70, false, false),
  "Severe failure must keep lowering governor support"
);
assert.equal(earnedOfficeholdingBonus(30), 0);
function registrationAfter(factor: number) {
  const parties = [
    { _id: "test-a", partyId: "a", organization: 60, registration: 40 },
    { _id: "test-b", partyId: "b", organization: 40, registration: 30 },
  ] as StatePartyOrg[];
  const pool = { independent: 20, unregistered: 10 } as StateRegistrationPool;
  for (let turn = 1; turn <= 192; turn++) {
    const planned = planStateRegDriftDecay({
      countryId: "US",
      stateId: "TEST",
      parties,
      pool,
      turn,
      now: new Date(0),
      governor: { partyId: "a", sign: factor },
    });
    assert.ok(planned);
    for (const update of planned.partyUpdates)
      parties.find((p) => p._id === update.rowId)!.registration = update.newReg;
    pool.independent = planned.poolUpdate.newIndependent;
    pool.unregistered = planned.poolUpdate.newUnregistered;
    const sum =
      parties.reduce((total, p) => total + p.registration!, 0) +
      pool.independent +
      pool.unregistered;
    assert.ok(Math.abs(sum - 100) < 1e-6, "Registration must conserve the electorate");
    assert.ok(
      parties.every((p) => p.registration! >= 0) && pool.independent >= 0 && pool.unregistered >= 0
    );
  }
  return parties[0].registration!;
}
const registration = [30, 50, 60, 70].map((approval) => ({
  approval,
  control: registrationAfter(1),
  treatment: registrationAfter(earnedOfficeholdingBonus(approval)),
}));
assert.ok(
  registration[0].treatment < registration[0].control,
  "Poor government must lose its officeholding registration edge"
);
assert.equal(registration[3].control, registration[3].treatment);
const report = {
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  sourceDirty:
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0,
  kind: "Synthetic paired mechanism qualification using the production swing-flow allocator",
  limits:
    "Not a historical replay, full world simulation, or seat-resolution qualification. Office labels select mechanisms; PR seat allocation, demographic evolution and endogenous party supply require integrated sandbox runs.",
  scenarios: rows.length,
  assertions: [
    "vote conservation",
    "nonnegative votes",
    "party label invariance",
    "unchanged successful-government treatment",
    "progressive governor severity",
    "no below-neutral registration bonus",
    "coalition responsibility",
    "registration conservation over 192 turns",
    "officeholding registration edge earned by approval",
  ],
  severity: [0, 20, 30, 40, 46, 70].map((approval) => ({
    approval,
    budget: executiveIncumbencyBudget(approval),
    homeFieldFactor: earnedOfficeholdingBonus(approval),
  })),
  rows,
  registration,
};
const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    sourceCommit: report.sourceCommit,
    sourceDirty: report.sourceDirty,
    scenarios: rows.length,
    assertions: report.assertions,
    severity: report.severity,
  })
);
