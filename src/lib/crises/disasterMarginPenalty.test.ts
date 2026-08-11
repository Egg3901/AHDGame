import { describe, it, expect } from "vitest";
import {
  computeDisasterMarginPenalty,
  computeDisasterPenaltySplit,
  disasterProductionFactor,
  buildDisasterEffectsByState,
} from "./disasterMarginPenalty";
import type { Crisis } from "@/lib/db/types/crisis";

const e = (over = {}) => ({
  value: -10,
  startTurn: 100,
  durationTurns: 20,
  sectorType: null,
  strategyId: null,
  ...over,
});
const sector = { sectorType: "agriculture", strategyId: null };

describe("computeDisasterMarginPenalty", () => {
  it("is full penalty at onset", () => {
    expect(computeDisasterMarginPenalty([e()], sector, 100)).toBe(-10);
  });
  it("is ~half at midpoint", () => {
    expect(computeDisasterMarginPenalty([e()], sector, 110)).toBeCloseTo(-5);
  });
  it("is 0 at expiry", () => {
    expect(computeDisasterMarginPenalty([e()], sector, 120)).toBe(0);
  });
  it("is 0 after expiry", () => {
    expect(computeDisasterMarginPenalty([e()], sector, 130)).toBe(0);
  });
  it("sums overlapping disasters", () => {
    expect(computeDisasterMarginPenalty([e(), e({ value: -6 })], sector, 100)).toBe(-16);
  });
  it("honors sectorType filter", () => {
    expect(computeDisasterMarginPenalty([e({ sectorType: "finance" })], sector, 100)).toBe(0);
  });
  it("honors strategyId filter", () => {
    expect(computeDisasterMarginPenalty([e({ strategyId: "X" })], sector, 100)).toBe(0);
  });
});

function makeCrisis(
  overrides: Partial<Pick<Crisis, "effects" | "startTurn" | "durationTurns" | "regionIds">> = {}
): Pick<Crisis, "effects" | "startTurn" | "durationTurns" | "regionIds"> {
  return {
    effects: [
      {
        effectType: "decay",
        targetType: "profitMargin",
        metricCategory: null,
        metricField: null,
        sectorType: null,
        strategyId: null,
        value: -10,
        label: "Test",
      },
    ],
    startTurn: 50,
    durationTurns: 20,
    regionIds: ["S1", "S2"],
    ...overrides,
  };
}

describe("buildDisasterEffectsByState", () => {
  it("expands one crisis across two regionIds into correct entries", () => {
    const map = buildDisasterEffectsByState([makeCrisis()]);
    expect(map.size).toBe(2);
    const s1 = map.get("S1")!;
    expect(s1).toHaveLength(1);
    expect(s1[0]).toEqual({
      value: -10,
      startTurn: 50,
      durationTurns: 20,
      sectorType: null,
      strategyId: null,
    });
    const s2 = map.get("S2")!;
    expect(s2).toHaveLength(1);
    expect(s2[0]).toEqual({
      value: -10,
      startTurn: 50,
      durationTurns: 20,
      sectorType: null,
      strategyId: null,
    });
  });

  it("skips a crisis with durationTurns: null", () => {
    const map = buildDisasterEffectsByState([makeCrisis({ durationTurns: null })]);
    expect(map.size).toBe(0);
  });

  it("skips a crisis whose only effect is non-decay", () => {
    const map = buildDisasterEffectsByState([
      makeCrisis({
        effects: [
          {
            effectType: "flat",
            targetType: "profitMargin",
            metricCategory: null,
            metricField: null,
            sectorType: null,
            strategyId: null,
            value: -5,
            label: "flat",
          },
        ],
      }),
    ]);
    expect(map.size).toBe(0);
  });

  it("uses a scope-aware resolver to expand a global crisis across all states", () => {
    const global = {
      ...makeCrisis({ regionIds: [] }),
      scope: "global" as const,
      countryIds: [],
    };
    const allStates = ["A", "B", "C"];
    const map = buildDisasterEffectsByState([global], (c) =>
      c.scope === "global" ? allStates : c.regionIds
    );
    expect([...map.keys()].sort()).toEqual(["A", "B", "C"]);
    expect(map.get("A")![0].value).toBe(-10);
  });

  it("skips a crisis whose only effect is non-profitMargin", () => {
    const map = buildDisasterEffectsByState([
      makeCrisis({
        effects: [
          {
            effectType: "decay",
            targetType: "metric",
            metricCategory: "approval",
            metricField: null,
            sectorType: null,
            strategyId: null,
            value: -5,
            label: "metric",
          },
        ],
      }),
    ]);
    expect(map.size).toBe(0);
  });
});

describe("computeDisasterPenaltySplit (P3.5)", () => {
  it("keeps everything on the margin leg below plants, even for physical effects", () => {
    const split = computeDisasterPenaltySplit([e({ physicality: "physical" })], sector, 100, false);
    expect(split).toEqual({ marginPenalty: -10, productionPenalty: 0 });
  });

  it("routes physical effects to the production leg under plants", () => {
    const split = computeDisasterPenaltySplit([e({ physicality: "physical" })], sector, 100, true);
    expect(split).toEqual({ marginPenalty: 0, productionPenalty: -10 });
  });

  it("keeps financial effects on the margin leg under plants", () => {
    const split = computeDisasterPenaltySplit([e({ physicality: "financial" })], sector, 100, true);
    expect(split).toEqual({ marginPenalty: -10, productionPenalty: 0 });
  });

  it("treats a missing physicality as financial under plants (pre-P3.5 crises)", () => {
    const split = computeDisasterPenaltySplit([e()], sector, 100, true);
    expect(split).toEqual({ marginPenalty: -10, productionPenalty: 0 });
  });

  it("splits a mixed set and decays both legs identically", () => {
    const entries = [e({ physicality: "physical" }), e({ value: -6, physicality: "financial" })];
    const split = computeDisasterPenaltySplit(entries, sector, 110, true);
    expect(split.productionPenalty).toBeCloseTo(-5);
    expect(split.marginPenalty).toBeCloseTo(-3);
  });

  it("sums to the legacy total regardless of classification", () => {
    const entries = [e({ physicality: "physical" }), e({ value: -6 })];
    const split = computeDisasterPenaltySplit(entries, sector, 105, true);
    expect(split.marginPenalty + split.productionPenalty).toBeCloseTo(
      computeDisasterMarginPenalty(entries, sector, 105)
    );
  });

  it("applies sector and strategy filters to both legs", () => {
    const entries = [e({ physicality: "physical", sectorType: "finance" })];
    expect(computeDisasterPenaltySplit(entries, sector, 100, true)).toEqual({
      marginPenalty: 0,
      productionPenalty: 0,
    });
  });
});

describe("disasterProductionFactor", () => {
  it("is exactly 1 with no physical penalty", () => {
    expect(disasterProductionFactor(0)).toBe(1);
  });
  it("converts penalty points to a multiplier", () => {
    expect(disasterProductionFactor(-25)).toBeCloseTo(0.75);
  });
  it("clamps stacked catastrophes at a full idle rather than inverting output", () => {
    expect(disasterProductionFactor(-140)).toBe(0);
  });
  it("ignores a positive penalty and non-finite input", () => {
    expect(disasterProductionFactor(5)).toBe(1);
    expect(disasterProductionFactor(Number.NaN)).toBe(1);
  });
});

describe("buildDisasterEffectsByState physicality passthrough", () => {
  it("carries physicality from the crisis effect onto the indexed entry", () => {
    const crisis = makeCrisis({
      effects: [
        {
          effectType: "decay",
          targetType: "profitMargin",
          metricCategory: null,
          metricField: null,
          sectorType: null,
          strategyId: null,
          value: -5,
          label: "Blackout",
          physicality: "physical",
        },
      ],
      regionIds: ["s1"],
    });
    const entries = buildDisasterEffectsByState([crisis]).get("s1") ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].physicality).toBe("physical");
  });

  it("leaves physicality undefined for a pre-P3.5 effect", () => {
    const crisis = makeCrisis({
      effects: [
        {
          effectType: "decay",
          targetType: "profitMargin",
          metricCategory: null,
          metricField: null,
          sectorType: null,
          strategyId: null,
          value: -5,
          label: "Legacy",
        },
      ],
      regionIds: ["s1"],
    });
    const entries = buildDisasterEffectsByState([crisis]).get("s1") ?? [];
    expect(entries[0].physicality).toBeUndefined();
  });
});
