import { describe, expect, it } from "vitest";
import {
  computeApprovalBaseFromAverages,
  APPROVAL_EXCLUDED_METRICS,
  IS_HIGHER_BETTER,
  getApprovalExcludedMetrics,
} from "./governmentApproval";

/**
 * The derived demographic readouts must not pollute approval scoring (design
 * §4.3.1 + §4.7 scoring-channel): `sexRatio` and `dependencyRatio` are 📊 readouts
 * with no monotonic approval term (their teeth are emergent downstream via
 * socialCohesion etc.), and `demographicDecline` must score lower-is-better
 * (higher = population aging/shrinkage = worse), not the `?? true` default.
 */
const ref = { population: { sexRatio: 50, dependencyRatio: 0.5, demographicDecline: 50 } };

describe("demographic readouts in approval scoring", () => {
  it("excludes sexRatio from the approval score (no monotonic term)", () => {
    const balanced = computeApprovalBaseFromAverages(
      { population: { sexRatio: 50 } },
      { population: { sexRatio: 50 } }
    );
    const skewed = computeApprovalBaseFromAverages(
      { population: { sexRatio: 80 } },
      { population: { sexRatio: 50 } }
    );
    expect(skewed).toBe(balanced); // a huge sexRatio deviation moves approval not at all
    expect(APPROVAL_EXCLUDED_METRICS.has("sexRatio")).toBe(true);
  });

  it("excludes dependencyRatio from the approval score", () => {
    const base = computeApprovalBaseFromAverages(
      { population: { dependencyRatio: 0.5 } },
      { population: { dependencyRatio: 0.5 } }
    );
    const high = computeApprovalBaseFromAverages(
      { population: { dependencyRatio: 0.9 } },
      { population: { dependencyRatio: 0.5 } }
    );
    expect(high).toBe(base);
    expect(APPROVAL_EXCLUDED_METRICS.has("dependencyRatio")).toBe(true);
  });

  it("excludes populationGrowth from the approval score (now an engine-derived stock, §4.7 audit-P2)", () => {
    const base = computeApprovalBaseFromAverages(
      { population: { populationGrowth: 0 } },
      { population: { populationGrowth: 0 } }
    );
    const high = computeApprovalBaseFromAverages(
      { population: { populationGrowth: 4 } },
      { population: { populationGrowth: 0 } }
    );
    expect(high).toBe(base); // a big populationGrowth deviation moves approval not at all
    expect(APPROVAL_EXCLUDED_METRICS.has("populationGrowth")).toBe(true);
  });

  it("excludes medianAge from the approval score (neutralizes secular-aging drift, §4.7 audit-P2)", () => {
    const young = computeApprovalBaseFromAverages(
      { population: { medianAge: 35 } },
      { population: { medianAge: 42 } }
    );
    const old = computeApprovalBaseFromAverages(
      { population: { medianAge: 50 } },
      { population: { medianAge: 42 } }
    );
    expect(old).toBe(young); // aging no longer mechanically erodes approval
    expect(APPROVAL_EXCLUDED_METRICS.has("medianAge")).toBe(true);
  });

  it("KEEPS migrationRate as a direct approval term (policy lever / coexistence wedge)", () => {
    const base = computeApprovalBaseFromAverages(
      { population: { migrationRate: 0 } },
      { population: { migrationRate: 0 } }
    );
    const inflow = computeApprovalBaseFromAverages(
      { population: { migrationRate: 1.5 } },
      { population: { migrationRate: 0 } }
    );
    expect(inflow).toBeGreaterThan(base); // migrationRate still moves approval (higher-is-better)
    expect(APPROVAL_EXCLUDED_METRICS.has("migrationRate")).toBe(false);
  });

  it("scores demographicDecline as lower-is-better (higher decline → lower approval)", () => {
    expect(IS_HIGHER_BETTER.demographicDecline).toBe(false);
    const lowDecline = computeApprovalBaseFromAverages(
      { population: { demographicDecline: 30 } },
      ref.population ? { population: { demographicDecline: 50 } } : {}
    );
    const highDecline = computeApprovalBaseFromAverages(
      { population: { demographicDecline: 70 } },
      { population: { demographicDecline: 50 } }
    );
    expect(lowDecline).toBeGreaterThan(highDecline);
  });
});

describe("getApprovalExcludedMetrics — 1991-default", () => {
  it("excludes broadbandAccess in 1991 preset", () => {
    expect(getApprovalExcludedMetrics("1991-default").has("broadbandAccess")).toBe(true);
  });
  it("excludes renewableEnergy in 1991 preset", () => {
    expect(getApprovalExcludedMetrics("1991-default").has("renewableEnergy")).toBe(true);
  });
  it("excludes energyTransitionProgress in 1991 preset", () => {
    expect(getApprovalExcludedMetrics("1991-default").has("energyTransitionProgress")).toBe(true);
  });
  it("excludes recyclingRate in 1991 preset", () => {
    expect(getApprovalExcludedMetrics("1991-default").has("recyclingRate")).toBe(true);
  });
  it("excludes carbonEmissions in 1991 preset", () => {
    expect(getApprovalExcludedMetrics("1991-default").has("carbonEmissions")).toBe(true);
  });
  it("does NOT exclude broadbandAccess in 2019 preset", () => {
    expect(getApprovalExcludedMetrics("2019-default").has("broadbandAccess")).toBe(false);
  });
  it("still excludes baseline metrics (sexRatio) in 1991 preset", () => {
    expect(getApprovalExcludedMetrics("1991-default").has("sexRatio")).toBe(true);
  });
});
