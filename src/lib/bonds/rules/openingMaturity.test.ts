import { describe, expect, it } from "vitest";
import { planOpeningSovereignMaturityCohorts } from "./openingMaturity";

const distribution = { 48: 0.25, 96: 0.35, 240: 0.4 } as const;

describe("planOpeningSovereignMaturityCohorts", () => {
  it("preserves face exactly while distributing established debt quarterly", () => {
    const cohorts = planOpeningSovereignMaturityCohorts({
      totalFace: 1_000_000,
      faceValue: 1_000,
      distribution,
    });

    expect(cohorts).toHaveLength(32);
    expect(cohorts.reduce((sum, cohort) => sum + cohort.amount, 0)).toBe(1_000_000);
    expect([...new Set(cohorts.map((cohort) => cohort.maturityOffset))]).toEqual(
      Array.from({ length: 20 }, (_, index) => (index + 1) * 12)
    );
    expect(
      cohorts.every(
        (cohort) => cohort.issuedAtOffset + cohort.maturityTurns === cohort.maturityOffset
      )
    ).toBe(true);
  });

  it("uses deterministic largest remainders for small non-even stocks", () => {
    const cohorts = planOpeningSovereignMaturityCohorts({
      totalFace: 11_000,
      faceValue: 1_000,
      distribution,
    });

    expect(cohorts.reduce((sum, cohort) => sum + cohort.amount, 0)).toBe(11_000);
    expect(cohorts.every((cohort) => cohort.amount >= 1_000)).toBe(true);
    expect(cohorts.every((cohort) => cohort.maturityOffset > 0)).toBe(true);
  });

  it("rejects unsafe money and a cadence that cannot divide every tenor", () => {
    expect(() =>
      planOpeningSovereignMaturityCohorts({
        totalFace: Number.MAX_SAFE_INTEGER + 1,
        faceValue: 1_000,
        distribution,
      })
    ).toThrow("Invalid opening debt face");
    expect(() =>
      planOpeningSovereignMaturityCohorts({
        totalFace: 10_000,
        faceValue: 1_000,
        distribution,
        intervalTurns: 7,
      })
    ).toThrow("Opening maturity must divide into whole cohorts");
  });
});
