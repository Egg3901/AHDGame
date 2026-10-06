/**
 * Deterministic balance probe for the party organization contribution bucket.
 *
 * Run: npx tsx scripts/sim/partyOrganizationBucket2026-10-04.ts
 */
import {
  applyOrganizationBuild,
  applyOrganizationDecay,
  deriveOrganizationShares,
  type OrganizationBucketRow,
} from "@/lib/parties/rules/organizationBucket";
import { ORG_DECAY_GRACE_TURNS, ORG_UNIT_DECAY_RATE } from "@/lib/constants/partyOrg";

function row(rows: readonly OrganizationBucketRow[], id: string) {
  const found = rows.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing organization row ${id}`);
  return found;
}

function freshPartyCurve(clickTargets: readonly number[]) {
  let rows: OrganizationBucketRow[] = [
    { id: "incumbent", organization: 80 },
    { id: "rival", organization: 20 },
    { id: "fresh", organization: 0, organizationUnits: 0 },
  ];
  let clicks = 0;
  const output: Array<{ clicks: number; fresh: number; incumbent: number }> = [];

  for (const target of clickTargets) {
    while (clicks < target) {
      const result = applyOrganizationBuild(rows, "fresh", clicks + 1);
      rows = result.rows;
      clicks += 1;
    }
    output.push({
      clicks,
      fresh: row(rows, "fresh").organization,
      incumbent: row(rows, "incumbent").organization,
    });
  }
  return output;
}

function decayCurve(decayTurns: readonly number[]) {
  let rows: OrganizationBucketRow[] = [
    {
      id: "stale",
      organization: 80,
      lastOrganizationBuildTurn: 0,
    },
    {
      id: "maintained",
      organization: 20,
      lastOrganizationBuildTurn: 0,
    },
  ];
  let previousTurn = ORG_DECAY_GRACE_TURNS - 1;
  const output: Array<{ decayTurns: number; staleUnits: number; staleShare: number }> = [];

  for (const elapsed of decayTurns) {
    const targetTurn = ORG_DECAY_GRACE_TURNS + elapsed - 1;
    for (let turn = previousTurn + 1; turn <= targetTurn; turn += 1) {
      // Hold the comparison row constant to isolate the stale party's decay.
      rows = rows.map((candidate) =>
        candidate.id === "maintained"
          ? { ...candidate, lastOrganizationBuildTurn: turn }
          : candidate
      );
      rows = applyOrganizationDecay(rows, turn).rows;
    }
    previousTurn = targetTurn;
    const stale = row(rows, "stale");
    output.push({
      decayTurns: elapsed,
      staleUnits: stale.organizationUnits ?? 0,
      staleShare: stale.organization,
    });
  }
  return { output, rows };
}

function clicksToReachShare(
  initialRows: readonly OrganizationBucketRow[],
  partyId: string,
  targetShare: number
) {
  let rows: OrganizationBucketRow[] = deriveOrganizationShares(initialRows).rows;
  let clicks = 0;
  while (row(rows, partyId).organization < targetShare) {
    const result = applyOrganizationBuild(rows, partyId, clicks + 1);
    rows = result.rows;
    clicks += 1;
    if (clicks > 1_000_000) throw new Error(`Share target ${targetShare}% did not converge`);
  }
  return { clicks, share: row(rows, partyId).organization };
}

const clickCurve = freshPartyCurve([1, 25, 80, 200, 400, 800, 801]);
const decay = decayCurve([1, 24, 69, 96, 168]);
const resumed = applyOrganizationBuild(decay.rows, "stale", 10_000);
const resumedStale = row(resumed.rows, "stale");
const emptyRegionEarn = clicksToReachShare(
  [{ id: "fresh", organization: 0, organizationUnits: 0 }],
  "fresh",
  20
);
const establishedThresholdRecovery = clicksToReachShare(
  [
    { id: "incumbent", organization: 80 },
    { id: "threshold", organization: 20 },
  ],
  "threshold",
  20
);
const crowdedRegionEarn = clicksToReachShare(
  [
    { id: "incumbent", organization: 80 },
    { id: "rival", organization: 20 },
    { id: "fresh", organization: 0, organizationUnits: 0 },
  ],
  "fresh",
  20
);

console.log("# Party organization bucket balance probe\n");
console.log("## Fresh party against a legacy 80% incumbent\n");
console.log("| Fresh clicks | Fresh Org% | Incumbent Org% |");
console.log("| ---: | ---: | ---: |");
for (const point of clickCurve) {
  console.log(`| ${point.clicks} | ${point.fresh.toFixed(2)}% | ${point.incumbent.toFixed(2)}% |`);
}

console.log("\n## Minor-party 20% earned-region threshold\n");
console.log("| Scenario | Clicks to at least 20% | Resulting Org% |");
console.log("| --- | ---: | ---: |");
console.log(
  `| Empty region, fresh party | ${emptyRegionEarn.clicks} | ${emptyRegionEarn.share.toFixed(2)}% |`
);
console.log(
  `| Legacy 20% party in a fully allocated region | ${establishedThresholdRecovery.clicks} | ${establishedThresholdRecovery.share.toFixed(2)}% |`
);
console.log(
  `| Fresh party against legacy 80% and 20% parties | ${crowdedRegionEarn.clicks} | ${crowdedRegionEarn.share.toFixed(2)}% |`
);

console.log(`\n## Inactivity decay starting at ${ORG_DECAY_GRACE_TURNS} inactive turns\n`);
console.log(`Rate: ${(ORG_UNIT_DECAY_RATE * 100).toFixed(2)}% of units per turn.`);
console.log("\n| Turns decaying | Stale units | Stale Org% |");
console.log("| ---: | ---: | ---: |");
for (const point of decay.output) {
  console.log(
    `| ${point.decayTurns} | ${point.staleUnits.toFixed(2)} | ${point.staleShare.toFixed(2)}% |`
  );
}

console.log("\n## Resume behavior\n");
console.log(
  `The next click adds exactly one unit (${(resumedStale.organizationUnits ?? 0).toFixed(2)} total) and resets lastOrganizationBuildTurn to ${resumedStale.lastOrganizationBuildTurn}.`
);
