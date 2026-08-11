import { describe, expect, it } from "vitest";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalLean, PoliticalMetricId } from "@/lib/politicalMetrics/types";
import {
  APPROVAL_AFFINITY_WEIGHT,
  APPROVAL_NEUTRAL_SCORE,
  APPROVAL_OBJECTIVE_WEIGHT,
  APPROVAL_POINTS_PER_SCORE,
  affinityScore,
  approvalComponent,
  approvalNeutralFor,
  electorateLean,
  metricAffinity,
  objectiveScore,
} from "./politicalApproval";

/** Board where every family's value is a function of its lean. */
function boardByLean(valueFor: (lean: PoliticalLean) => number): Record<PoliticalMetricId, number> {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) out[f.id] = valueFor(f.lean);
  return out;
}

const uniform = (v: number) => boardByLean(() => v);

describe("politicalApproval — hybrid model properties (spec §2/§6)", () => {
  it("weights are the 70/30 split and sum to 1", () => {
    expect(APPROVAL_OBJECTIVE_WEIGHT).toBe(0.7);
    expect(APPROVAL_AFFINITY_WEIGHT).toBe(0.3);
    expect(APPROVAL_OBJECTIVE_WEIGHT + APPROVAL_AFFINITY_WEIGHT).toBe(1);
  });

  it("uniform board: objective and affinity scores both equal the value, any electorate", () => {
    for (const e of [-5, -2.5, 0, 1.3, 5]) {
      expect(objectiveScore(uniform(62))).toBeCloseTo(62, 9);
      expect(affinityScore(uniform(62), e)).toBeCloseTo(62, 9);
    }
  });

  it("lean-0 floor: affinity for lean-0 metrics is >= 0.5 for every electorate", () => {
    for (const e of [-5, -4, -1, 0, 2, 5]) {
      expect(metricAffinity(e, 0)).toBeGreaterThanOrEqual(0.5);
    }
    expect(metricAffinity(0, 0)).toBe(1);
    expect(metricAffinity(5, -5)).toBe(0);
  });

  it("mirror invariance: symmetric electorates score mirrored boards identically", () => {
    // v depends only on the SIGN of lean → mirror(board) swaps left/right values.
    const right = boardByLean((l) => (l > 0 ? 80 : l < 0 ? 40 : 50));
    const left = boardByLean((l) => (l < 0 ? 80 : l > 0 ? 40 : 50));
    expect(affinityScore(right, 4)).toBeCloseTo(affinityScore(left, -4), 9);
    expect(affinityScore(right, 0)).toBeCloseTo(affinityScore(left, 0), 9);
  });

  it("a +4 electorate feels the right-lean board; objective score is blind to the mirror", () => {
    const right = boardByLean((l) => (l > 0 ? 80 : l < 0 ? 40 : 50));
    const left = boardByLean((l) => (l < 0 ? 80 : l > 0 ? 40 : 50));
    expect(objectiveScore(right)).toBeCloseTo(objectiveScore(left), 9);
    expect(affinityScore(right, 4)).toBeGreaterThan(affinityScore(left, 4));
    // The objective 70% keeps the misaligned board's quality from being ignorable:
    // an aligned-but-poor board must not beat a misaligned-but-good board.
    const alignedPoor = boardByLean((l) => (l > 0 ? 45 : 30));
    expect(approvalComponent(left, 4, "US")).toBeGreaterThan(
      approvalComponent(alignedPoor, 4, "US")
    );
  });

  it("electorateLean averages the cached SSOT pair; missing data → 0 (flat model)", () => {
    expect(electorateLean({ cachedEconomicLean: -2, cachedSocialLean: 1 })).toBe(-0.5);
    expect(electorateLean({})).toBe(0);
    expect(electorateLean({ cachedEconomicLean: 3 })).toBe(0);
    expect(electorateLean({ cachedEconomicLean: null, cachedSocialLean: 2 })).toBe(0);
    // Clamped to the -5..+5 lean scale even if a cache is out of range.
    expect(electorateLean({ cachedEconomicLean: 9, cachedSocialLean: 9 })).toBe(5);
  });

  it("component is 0 at the neutral score and scales linearly on uniform moves", () => {
    const neutral = APPROVAL_NEUTRAL_SCORE.US;
    expect(approvalComponent(uniform(neutral), 0, "US")).toBeCloseTo(0, 9);
    expect(approvalComponent(uniform(neutral + 10), 0, "US")).toBeCloseTo(
      10 * APPROVAL_POINTS_PER_SCORE,
      9
    );
    expect(approvalComponent(uniform(neutral - 10), 2, "US")).toBeCloseTo(
      -10 * APPROVAL_POINTS_PER_SCORE,
      9
    );
  });
});

describe("non-playable approval intercepts", () => {
  it("calibrates every country the board covers, in every era it covers", async () => {
    const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
    for (const [presetId, byCountry] of Object.entries(NON_PLAYABLE_BOARDS)) {
      for (const countryId of Object.keys(byCountry)) {
        expect(
          Number.isFinite(approvalNeutralFor(countryId, presetId)),
          `${presetId}/${countryId}`
        ).toBe(true);
      }
    }
  });

  it("keeps the playables on their authored, era-agnostic intercepts", () => {
    // The four are CALIBRATION against their national baseline board, not
    // derivation, and they resolve the same at every preset — their anchors
    // hold one 1953 value per family, so there is nothing era-varying yet.
    for (const presetId of ["1953-default", "2019-default"]) {
      expect(approvalNeutralFor("US", presetId)).toBe(64.92);
      expect(approvalNeutralFor("DD", presetId)).toBe(55.0);
    }
    expect(APPROVAL_NEUTRAL_SCORE.US).toBe(64.92);
    expect(APPROVAL_NEUTRAL_SCORE.UK).toBe(63.06);
    expect(APPROVAL_NEUTRAL_SCORE.RU).toBe(58.91);
    expect(APPROVAL_NEUTRAL_SCORE.DD).toBe(55.0);
  });

  it("starts a freshly seeded non-playable country approval-neutral", async () => {
    // THE parity bar for the cutover: on the day-one board, with the seed-time
    // electorate lean of 0, the approval component must be ~0 for every region
    // of every country — otherwise widening the routing lurches approval.
    const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
    const entries = Object.entries(NON_PLAYABLE_BOARDS).flatMap(([presetId, byCountry]) =>
      Object.entries(byCountry).map(([countryId, byRegion]) => ({ presetId, countryId, byRegion }))
    );
    for (const { presetId, countryId, byRegion } of entries) {
      const components = Object.values(byRegion).map((values) =>
        approvalComponent(values as Record<PoliticalMetricId, number>, 0, countryId, presetId)
      );
      // Per region the component varies with that region's own board; the
      // country's POPULATION-weighted centre is what the intercept zeroes, so
      // the unweighted mean is near-zero rather than exactly zero. Bounds are
      // set just above the measured worst case (mean 0.364 at DE, single region
      // 1.28) so a regression that de-calibrates the intercept fails here
      // instead of quietly shifting approval.
      const mean = components.reduce((a, b) => a + b, 0) / components.length;
      expect(Math.abs(mean), `${presetId}/${countryId} mean`).toBeLessThan(0.5);
      for (const c of components) {
        expect(Math.abs(c), `${presetId}/${countryId} region`).toBeLessThan(2);
      }
    }
  });

  it("throws rather than defaulting for an uncalibrated country", () => {
    expect(() => approvalComponent(uniform(50), 0, "ZZ", "1953-default")).toThrow(
      /No APPROVAL_NEUTRAL_SCORE/
    );
    // A real country at an era with no emitted board is equally uncalibrated.
    expect(() => approvalComponent(uniform(50), 0, "JP", "1899-default")).toThrow(
      /No APPROVAL_NEUTRAL_SCORE/
    );
  });
});
