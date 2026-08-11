import { describe, it, expect } from "vitest";
import type { Layer1Config } from "@/lib/seeds/stateDemographics";
import { getEraPositions, DEMOGRAPHIC_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";
import { stateCensusData } from "@/lib/seeds/stateCensusData";
import {
  deriveGranularCells,
  deriveGranularCellsGeneric,
  aggregateCells,
  ASSOCIATION_PRIORS,
  COUNTRY_PRIORS,
  GRANULAR_DIMENSIONS,
  type GranularDim,
  type GranularCell,
  type GenericGranularCell,
  type GenericGranularDimInput,
} from "./granularCells";
import ctFixture from "./granularCells.fixture.json";

/** Merge era-wide positions with any state-specific overrides from the config. */
function resolvePositions(config: Layer1Config) {
  const merged: Record<
    GranularDim,
    Record<string, { economicLean: number; socialLean: number }>
  > = JSON.parse(JSON.stringify(getEraPositions("2019")));
  if (config.positions) {
    for (const dim of GRANULAR_DIMENSIONS) {
      const overrides = config.positions[dim];
      if (overrides) {
        for (const [key, pos] of Object.entries(overrides)) {
          merged[dim][key] = pos;
        }
      }
    }
  }
  return merged;
}

function ctConfig(): Layer1Config {
  return stateCensusData.CT;
}

function ohConfig(): Layer1Config {
  return stateCensusData.OH;
}

function marginalSums(cells: GranularCell[], dim: GranularDim): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const c of cells) {
    sums[c[dim]] = (sums[c[dim]] ?? 0) + c.share;
  }
  return sums;
}

describe("deriveGranularCells", () => {
  it("reconstructs input marginals within 0.5pp for CT", () => {
    const config = ctConfig();
    const cells = deriveGranularCells(config, resolvePositions(config), DEMOGRAPHIC_TURNOUT_RATES, {
      pruneFloor: 0,
    });
    for (const dim of GRANULAR_DIMENSIONS) {
      const sums = marginalSums(cells, dim);
      for (const [key, pct] of Object.entries(config[dim] as Record<string, number>)) {
        expect(sums[key] ?? 0).toBeCloseTo(pct / 100, 3); // 0.5pp = 0.005 proportion
      }
    }
  });

  it("reconstructs input marginals within 0.5pp for OH", () => {
    const config = ohConfig();
    const cells = deriveGranularCells(config, resolvePositions(config), DEMOGRAPHIC_TURNOUT_RATES, {
      pruneFloor: 0,
    });
    for (const dim of GRANULAR_DIMENSIONS) {
      const sums = marginalSums(cells, dim);
      for (const [key, pct] of Object.entries(config[dim] as Record<string, number>)) {
        expect(sums[key] ?? 0).toBeCloseTo(pct / 100, 3);
      }
    }
  });

  it("produces valid default-pruned cells for CT and OH", () => {
    for (const config of [ctConfig(), ohConfig()]) {
      const cells = deriveGranularCells(
        config,
        resolvePositions(config),
        DEMOGRAPHIC_TURNOUT_RATES
      );
      const totalShare = cells.reduce((s, c) => s + c.share, 0);
      expect(totalShare).toBeCloseTo(1, 6);
      for (const c of cells) {
        expect(c.share).toBeGreaterThanOrEqual(0.001);
        expect(c.economicLean).toBeGreaterThanOrEqual(-5);
        expect(c.economicLean).toBeLessThanOrEqual(5);
        expect(c.socialLean).toBeGreaterThanOrEqual(-5);
        expect(c.socialLean).toBeLessThanOrEqual(5);
        expect(c.turnout).toBeGreaterThanOrEqual(15);
        expect(c.turnout).toBeLessThanOrEqual(95);
      }
    }
  });

  it("returns deterministic output for the same input", () => {
    const config = ctConfig();
    const positions = resolvePositions(config);
    const a = deriveGranularCells(config, positions, DEMOGRAPHIC_TURNOUT_RATES);
    const b = deriveGranularCells(config, positions, DEMOGRAPHIC_TURNOUT_RATES);
    expect(a).toEqual(b);
  });

  it("association priors shift joint cells in the documented direction vs independence", () => {
    const config = ctConfig();
    const positions = resolvePositions(config);
    const neutralPriors: Record<string, number> = {};
    for (const k of Object.keys(ASSOCIATION_PRIORS)) {
      neutralPriors[k] = 1.0;
    }

    const independent = deriveGranularCells(config, positions, DEMOGRAPHIC_TURNOUT_RATES, {
      pruneFloor: 0,
      priors: neutralPriors,
    });
    const withPriors = deriveGranularCells(config, positions, DEMOGRAPHIC_TURNOUT_RATES, {
      pruneFloor: 0,
    });

    // A cell where multiple positive priors align should grow vs independence.
    // White + graduate + high wealth + senior is boosted by white/graduate,
    // white/high, graduate/high, and senior/high priors.
    const alignedKey = "white|senior|graduate|high";
    const alignedIndep = independent.find((c) => c.id === alignedKey)!;
    const alignedPrior = withPriors.find((c) => c.id === alignedKey)!;
    expect(alignedPrior.share).toBeGreaterThan(alignedIndep.share);

    // Hispanic + no-college + low wealth + young is boosted by hispanic/no-college,
    // hispanic/low, no-college/low, and young/low priors.
    const boostedKey = "hispanic|young|no_college|low";
    const boostedIndep = independent.find((c) => c.id === boostedKey)!;
    const boostedPrior = withPriors.find((c) => c.id === boostedKey)!;
    expect(boostedPrior.share).toBeGreaterThan(boostedIndep.share);

    // White + no-college + high wealth + senior is pushed down by no-college/high
    // and white/no-college priors despite some offsetting positives.
    const suppressedKey = "white|senior|no_college|high";
    const suppressedIndep = independent.find((c) => c.id === suppressedKey)!;
    const suppressedPrior = withPriors.find((c) => c.id === suppressedKey)!;
    expect(suppressedPrior.share).toBeLessThan(suppressedIndep.share);
  });

  it("aggregateCells returns share-weighted aggregates", () => {
    const config = ctConfig();
    const cells = deriveGranularCells(config, resolvePositions(config), DEMOGRAPHIC_TURNOUT_RATES);
    const white = aggregateCells(cells, (c) => c.race === "white");
    const whiteSums = marginalSums(cells, "race");
    expect(white.share).toBeCloseTo(whiteSums.white, 6);
    expect(white.economicLean).toBeGreaterThanOrEqual(-5);
    expect(white.economicLean).toBeLessThanOrEqual(5);
    expect(white.turnout).toBeGreaterThanOrEqual(15);
    expect(white.turnout).toBeLessThanOrEqual(95);
  });

  it("matches the pre-refactor regression fixture for CT with default pruning", () => {
    const config = ctConfig();
    const cells = deriveGranularCells(config, resolvePositions(config), DEMOGRAPHIC_TURNOUT_RATES);
    expect(cells).toEqual(ctFixture.default);
  });

  it("matches the pre-refactor regression fixture for CT without pruning", () => {
    const config = ctConfig();
    const cells = deriveGranularCells(config, resolvePositions(config), DEMOGRAPHIC_TURNOUT_RATES, {
      pruneFloor: 0,
    });
    expect(cells).toEqual(ctFixture.unpruned);
  });

  it("exports the US priors through both COUNTRY_PRIORS and ASSOCIATION_PRIORS", () => {
    expect(COUNTRY_PRIORS["US"]).toBe(ASSOCIATION_PRIORS);
  });
});

describe("deriveGranularCellsGeneric", () => {
  it("derives cells from arbitrary dimensions and reconstructs marginals", () => {
    const dims: GenericGranularDimInput[] = [
      {
        name: "region",
        marginals: { north: 40, south: 35, west: 25 },
        positions: {
          north: { economicLean: -2, socialLean: -1 },
          south: { economicLean: 1, socialLean: 2 },
          west: { economicLean: -1, socialLean: 0 },
        },
        turnoutRates: { north: 60, south: 55, west: 65 },
      },
      {
        name: "age",
        marginals: { young: 30, old: 70 },
        positions: {
          young: { economicLean: -1, socialLean: -2 },
          old: { economicLean: 0, socialLean: 1 },
        },
        turnoutRates: { young: 40, old: 75 },
      },
    ];

    const cells = deriveGranularCellsGeneric({ dims, priors: {}, opts: { pruneFloor: 0 } });
    expect(cells.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 6);
    expect(cells.length).toBe(3 * 2);

    for (const dim of dims) {
      const sums: Record<string, number> = {};
      for (const c of cells) {
        sums[c.buckets[dim.name]] = (sums[c.buckets[dim.name]] ?? 0) + c.share;
      }
      for (const [key, pct] of Object.entries(dim.marginals)) {
        expect(sums[key] ?? 0).toBeCloseTo(pct / 100, 3);
      }
    }

    const north = cells.find((c) => c.buckets.region === "north" && c.buckets.age === "old")!;
    expect(north.economicLean).toBe(-1); // average of -2 and 0
    expect(north.socialLean).toBe(0); // average of -1 and 1
  });

  it("excludes dimensions without positions from lean calculation", () => {
    const dims: GenericGranularDimInput[] = [
      {
        name: "a",
        marginals: { x: 50, y: 50 },
        positions: { x: { economicLean: 2, socialLean: 2 } },
      },
      {
        name: "b",
        marginals: { x: 50, y: 50 },
        // no positions table
      },
    ];
    const cells = deriveGranularCellsGeneric({ dims, opts: { pruneFloor: 0 } });
    const cell = cells.find((c) => c.buckets.a === "x" && c.buckets.b === "x")!;
    // Only dimension 'a' contributes; bucket x is present, so average is just 2.
    expect(cell.economicLean).toBe(2);
    expect(cell.socialLean).toBe(2);
  });

  it("falls back to default lean and turnout when no dimension provides them", () => {
    const dims: GenericGranularDimInput[] = [
      { name: "a", marginals: { x: 50, y: 50 } },
      { name: "b", marginals: { x: 50, y: 50 } },
    ];
    const cells = deriveGranularCellsGeneric({ dims, opts: { pruneFloor: 0 } });
    for (const c of cells) {
      expect(c.economicLean).toBe(0);
      expect(c.socialLean).toBe(0);
      expect(c.turnout).toBe(55);
    }
  });

  it("uses pairwise priors across arbitrary dimensions", () => {
    const dims: GenericGranularDimInput[] = [
      {
        name: "a",
        marginals: { x: 50, y: 50 },
        positions: { x: { economicLean: 0, socialLean: 0 } },
      },
      {
        name: "b",
        marginals: { x: 50, y: 50 },
        positions: { x: { economicLean: 0, socialLean: 0 } },
      },
    ];
    const priors = { "a:x|b:x": 2.0 };
    const cells = deriveGranularCellsGeneric({ dims, priors, opts: { pruneFloor: 0 } });
    const xx = cells.find((c) => c.buckets.a === "x" && c.buckets.b === "x")!;
    const xy = cells.find((c) => c.buckets.a === "x" && c.buckets.b === "y")!;
    expect(xx.share).toBeGreaterThan(xy.share);
  });

  it("aggregateCells works with generic cells", () => {
    const cells: GenericGranularCell[] = [
      {
        id: "a|x",
        buckets: { a: "x" },
        share: 0.6,
        economicLean: 1,
        socialLean: 2,
        turnout: 50,
      },
      {
        id: "a|y",
        buckets: { a: "y" },
        share: 0.4,
        economicLean: -1,
        socialLean: -2,
        turnout: 70,
      },
    ];
    const agg = aggregateCells(cells, (c) => c.buckets.a === "x");
    expect(agg.share).toBeCloseTo(0.6, 6);
    expect(agg.economicLean).toBeCloseTo(1, 6);
    expect(agg.turnout).toBeCloseTo(50, 6);
  });
});
