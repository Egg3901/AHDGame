/** Deterministic qualification of corrected referendum rules, without a DB. */
import assert from "node:assert/strict";
import { buildReferendumCohorts, aggregateYesShare } from "@/lib/referendum/cohortEngine";
import { cohortTurnout } from "@/lib/referendum/rules/cohorts";
import { constitutionalConsentForce } from "@/lib/referendum/rules/consent";
import { nppReferendumDecision } from "@/lib/referendum/rules/decisions";
import { cohortAffinitiesFor } from "@/lib/constants/referendumCohorts";
import { getBucketProfileForRegion } from "@/lib/demographics/bucketProfile";
const scenarios = [];
for (const preset of ["1991-default", "2019-default"]) {
  for (const region of ["SCO", "WAL", "NIR"]) {
    const profile = getBucketProfileForRegion("UK", region, preset)!;
    for (const desire of [0, 2, 30, 50, 60, 80, 98, 100]) {
      const cohorts = buildReferendumCohorts(profile, desire, cohortAffinitiesFor(region));
      const support = aggregateYesShare(cohorts, [], 0);
      const turnout = cohortTurnout(cohorts, [], 20);
      assert(Math.abs(support - desire) < 1e-8);
      assert(Number.isFinite(turnout) && turnout >= 0 && turnout <= 100);
      // Reproduce the previous one-pass recentering for a baseline arm.
      const sections = profile.filter((s) => s.buckets.length > 1);
      const affinity = cohortAffinitiesFor(region);
      const raw = sections.flatMap((s) =>
        s.buckets.map((b) => ({
          groupId: b.id,
          share: b.sharePct / 100 / sections.length,
          turnout: b.turnout,
          yesLean: Math.max(0, Math.min(100, desire + (affinity[b.id] ?? 0))),
        }))
      );
      const offset = desire - aggregateYesShare(raw, [], 0);
      const previous = aggregateYesShare(
        raw.map((c) => ({ ...c, yesLean: Math.max(0, Math.min(100, c.yesLean + offset)) })),
        [],
        0
      );
      const consent = ["yes", "no", null].map((side) =>
        constitutionalConsentForce(
          {
            yesShare: 60,
            partyPositions: side ? [{ partyId: "1", side: side as "yes" | "no" }] : [],
          },
          "1"
        )
      );
      assert.deepEqual(consent, [40, -20, 10]);
      for (const stance of ["anti", "pro", "independence"] as const) {
        assert.equal(nppReferendumDecision(123, 100, stance), null);
        assert.equal(
          nppReferendumDecision(124, 100, stance),
          stance === "anti" ? "decline" : "grant"
        );
      }
      scenarios.push({ preset, region, desire, previous, support, turnout, consent });
    }
  }
}
console.log(
  JSON.stringify(
    {
      qualification: "deterministic referendum rules; not a full-world or remote-Mongo benchmark",
      scenarios: scenarios.length,
      passed: true,
      results: scenarios,
    },
    null,
    2
  )
);
