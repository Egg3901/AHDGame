import { describe, expect, it } from "vitest";
import { computeCareerScore, type CareerScoreInputs } from "./careerScore";
const empty: CareerScoreInputs = {
  nationalInfluence: 0,
  partyInfluence: 0,
  achievementCount: 0,
  highestOfficeRank: 0,
  infamy: 0,
  netWorthAnchor: 0,
  enactedBills: 0,
  contestWins: 0,
  contestPodiums: 0,
};
describe("balanced career scoring", () => {
  it("gives each career area credit and bounds every pillar", () => {
    for (const key of [
      "nationalInfluence",
      "partyInfluence",
      "achievementCount",
      "highestOfficeRank",
      "netWorthAnchor",
      "enactedBills",
      "contestWins",
      "contestPodiums",
    ] as const) {
      const score = computeCareerScore({ ...empty, [key]: 100 });
      expect(score.total).toBeGreaterThan(0);
      expect(score.total).toBeLessThanOrEqual(1_000);
    }
    const all = computeCareerScore(
      Object.fromEntries(
        Object.keys(empty).map((key) => [key, key === "infamy" ? 0 : 1e12])
      ) as unknown as CareerScoreInputs
    );
    expect(all.total).toBeLessThanOrEqual(5_000);
    expect(
      all.breakdown.nationalInfluence + all.breakdown.partyInfluence + all.breakdown.officeTier
    ).toBeLessThanOrEqual(1_000);
  });
  it("credits enacted bills and settled contest wins, with diminishing returns", () => {
    const first = computeCareerScore({
      ...empty,
      enactedBills: 1,
      contestWins: 1,
      contestPodiums: 1,
    }).total;
    const tenth = computeCareerScore({
      ...empty,
      enactedBills: 10,
      contestWins: 10,
      contestPodiums: 10,
    }).total;
    expect(tenth).toBeGreaterThan(first);
    expect(tenth).toBeLessThan(first * 10);
  });
  it("never turns debt, invalid numbers or infamy into extra points", () => {
    expect(
      computeCareerScore({
        ...empty,
        netWorthAnchor: -1_000,
        nationalInfluence: NaN,
        partyInfluence: Infinity,
        infamy: -10,
      }).total
    ).toBe(0);
    expect(computeCareerScore({ ...empty, nationalInfluence: 100, infamy: 100 }).total).toBe(0);
  });
});
