import { describe, expect, it } from "vitest";
import { buildCoalitionWeakness, buildParticipationPlan } from "./briefing";
import type { CandidateNationalLedger } from "@/lib/electionEngine/factorLedger";

function candidate(
  id: string,
  finalVotes: number,
  buckets: Record<string, number>
): CandidateNationalLedger {
  return {
    candidateId: id,
    nominalWeight: 1,
    finalVotes,
    factors: [],
    bucketAppeal: Object.entries(buckets).map(([bucket, appealShare]) => ({
      candidateId: id,
      bucket,
      appealShare,
      demoEP: 0,
      demoSP: 0,
    })),
  };
}

describe("buildCoalitionWeakness", () => {
  it("ranks a group the candidate is losing above one that is merely small", () => {
    // "race:small" is 5% of the owner's appeal but they hold almost all of it.
    // "race:big" is 60% of their appeal and they are being beaten in it. The
    // old ranking read the owner's own appeal share and so led with the group
    // they were winning.
    const owner = candidate("me", 1_000, { "race:small": 0.05, "race:big": 0.6 });
    const rival = candidate("them", 1_000, { "race:small": 0.001, "race:big": 0.9 });

    const weak = buildCoalitionWeakness([owner, rival], "me");

    expect(weak[0].bucket).toBe("race:big");
    expect(weak[0].bucketShare).toBeCloseTo(0.4, 2);
    expect(weak[1].bucket).toBe("race:small");
    expect(weak[1].bucketShare).toBeGreaterThan(0.9);
  });

  it("weighs each candidate's pull by the votes their appeal actually won", () => {
    // Equal appeal shares, but the rival turned them into four times the votes,
    // so the owner holds a fifth of the group rather than half of it.
    const owner = candidate("me", 1_000, { "age:young": 0.5 });
    const rival = candidate("them", 4_000, { "age:young": 0.5 });

    const weak = buildCoalitionWeakness([owner, rival], "me");
    expect(weak[0].bucketShare).toBeCloseTo(0.2, 5);
  });

  it("reads an uncontested group as fully held rather than dividing by zero", () => {
    const owner = candidate("me", 0, { "race:white": 0.4 });
    const weak = buildCoalitionWeakness([owner], "me");
    expect(weak[0].bucketShare).toBe(1);
  });

  it("still reports how much of the owner's own coalition each group is", () => {
    const owner = candidate("me", 1_000, { "race:white": 0.4 });
    const weak = buildCoalitionWeakness([owner], "me");
    expect(weak[0].appealShare).toBeCloseTo(0.4, 5);
  });

  it("returns the five weakest and no more", () => {
    const buckets = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`dim:b${i}`, (i + 1) / 100])
    );
    const owner = candidate("me", 1_000, buckets);
    const rival = candidate("them", 1_000, buckets);
    expect(buildCoalitionWeakness([owner, rival], "me")).toHaveLength(5);
  });

  it("reports nothing before a general election has produced a ledger", () => {
    expect(buildCoalitionWeakness(undefined, "me")).toEqual([]);
    expect(buildCoalitionWeakness([], "me")).toEqual([]);
  });

  it("reports nothing for a viewer with no candidacy in the race", () => {
    const owner = candidate("me", 1_000, { "race:white": 0.4 });
    expect(buildCoalitionWeakness([owner], null)).toEqual([]);
    expect(buildCoalitionWeakness([owner], "someone-else")).toEqual([]);
  });
});

describe("buildParticipationPlan", () => {
  it("recommends persuasion when repeat contact is losing efficiency", () => {
    const plan = buildParticipationPlan(
      {
        calibrationId: "US-v1",
        baseline: 60,
        salience: 1,
        competitiveness: 2,
        access: -1,
        contact: 3,
        saturation: -1,
        resolvedTurnout: 64,
        economicSalience: 1,
        socialSalience: 1,
        competitivenessScore: 0.8,
      },
      [{ bucket: "age:young", appealShare: 0.2, bucketShare: 0.35, demoEP: -1, demoSP: 0 }]
    );
    expect(plan?.targets[0]).toMatchObject({ bucket: "age:young", action: "targeted_ads" });
  });
});
