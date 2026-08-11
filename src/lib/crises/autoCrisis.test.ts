import { describe, it, expect } from "vitest";
import { regionMatchesTags, getRegionHazards } from "./regionHazards";
import { isDisasterAllowedInCountry } from "./selectDisasterTemplate";
import { HURRICANE_TEMPLATE, TORNADO_TEMPLATE, TSUNAMI_TEMPLATE } from "./templates";
import { deterministicRoll } from "./autoCrisisConstants";
import { isOnCooldown } from "./autoCrisisCooldown";
import type { CrisisAutoCooldown, TriggerCondition } from "@/lib/db/types/crisis";
import { evaluateCondition, type NationalSnapshot } from "./autoCrisisConditions";

describe("region hazards", () => {
  it("gates by required tags (all must match)", () => {
    expect(regionMatchesTags("US", "FL", ["coastal"])).toBe(true);
    expect(regionMatchesTags("US", "KS", ["tornado"])).toBe(true);
    expect(regionMatchesTags("US", "KS", ["coastal"])).toBe(false);
    // Tsunami needs coastal AND seismic.
    expect(regionMatchesTags("JP", "KAN", ["coastal", "seismic"])).toBe(true);
    expect(regionMatchesTags("US", "FL", ["coastal", "seismic"])).toBe(false); // FL not seismic
  });

  it("no requirement matches any region", () => {
    expect(regionMatchesTags("DE", "BW", [])).toBe(true);
    expect(regionMatchesTags("DE", "BW", undefined)).toBe(true);
  });

  it("tags landlocked German states without coast/seismic hazards", () => {
    expect(getRegionHazards("DE", "BW")).not.toContain("coastal");
    expect(getRegionHazards("DE", "BW")).not.toContain("seismic");
    expect(getRegionHazards("DE", "SH")).toContain("coastal");
  });
});

describe("disaster country gating", () => {
  it("allows hurricanes in the US but not Germany", () => {
    expect(isDisasterAllowedInCountry(HURRICANE_TEMPLATE, "US")).toBe(true);
    expect(isDisasterAllowedInCountry(HURRICANE_TEMPLATE, "DE")).toBe(false);
  });

  it("no German region is hurricane-eligible (gated by country and coast)", () => {
    // Even DE coastal states can't get a hurricane: the template excludes DE.
    expect(isDisasterAllowedInCountry(HURRICANE_TEMPLATE, "DE")).toBe(false);
  });

  it("tornado requires the tornado tag; tsunami requires coastal+seismic", () => {
    expect(TORNADO_TEMPLATE.geo?.requiresRegionTags).toEqual(["tornado"]);
    expect(TSUNAMI_TEMPLATE.geo?.requiresRegionTags).toEqual(["coastal", "seismic"]);
  });
});

describe("deterministicRoll", () => {
  it("is stable for the same inputs and within [0,1)", () => {
    const a = deterministicRoll(10, "pandemic", "GLOBAL");
    const b = deterministicRoll(10, "pandemic", "GLOBAL");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it("varies across keys", () => {
    expect(deterministicRoll(10, "pandemic", "GLOBAL")).not.toBe(
      deterministicRoll(11, "pandemic", "GLOBAL")
    );
    expect(deterministicRoll(10, "pandemic", "US")).not.toBe(
      deterministicRoll(10, "cyber_attack", "US")
    );
  });
});

describe("cooldown gate", () => {
  const map = new Map<string, CrisisAutoCooldown>([
    [
      "recession:US",
      {
        _id: "recession:US",
        templateKey: "recession",
        scopeKey: "US",
        lastSpawnTurn: 100,
        updatedAt: new Date(0),
      },
    ],
  ]);

  it("is on cooldown before the window elapses and off after", () => {
    expect(isOnCooldown(map, "recession", "US", 200, 144)).toBe(true); // 100 elapsed < 144
    expect(isOnCooldown(map, "recession", "US", 244, 144)).toBe(false); // exactly 144 elapsed
    expect(isOnCooldown(map, "recession", "US", 300, 144)).toBe(false);
  });

  it("is never on cooldown for an unseen template/scope", () => {
    expect(isOnCooldown(map, "recession", "UK", 101, 144)).toBe(false);
    expect(isOnCooldown(map, "pandemic", "GLOBAL", 101, 144)).toBe(false);
  });
});

function snapshot(over: Partial<NationalSnapshot>): NationalSnapshot {
  return {
    countryId: "US",
    current: {},
    histories: {},
    fxDepreciation: () => null,
    ...over,
  };
}

describe("condition evaluation", () => {
  it("recession: gdpGrowth < 0 for 2 consecutive turns", () => {
    const cond: TriggerCondition = {
      all: [{ metric: "gdpGrowth", op: "lt", threshold: 0, consecutiveTurns: 2 }],
    };
    expect(evaluateCondition(cond, snapshot({ histories: { gdpGrowth: [1.2, -0.5, -1.1] } }))).toBe(
      true
    );
    expect(evaluateCondition(cond, snapshot({ histories: { gdpGrowth: [-2.0, 0.3] } }))).toBe(
      false
    );
    expect(evaluateCondition(cond, snapshot({ histories: { gdpGrowth: [-1.0] } }))).toBe(false); // not enough history
  });

  it("inflation spike: single-turn threshold", () => {
    const cond: TriggerCondition = { all: [{ metric: "inflationRate", op: "gt", threshold: 7 }] };
    expect(evaluateCondition(cond, snapshot({ current: { inflationRate: 8.1 } }))).toBe(true);
    expect(evaluateCondition(cond, snapshot({ current: { inflationRate: 5 } }))).toBe(false);
    expect(evaluateCondition(cond, snapshot({}))).toBe(false); // missing metric
  });

  it("mass protests: compound AND of approval and unemployment", () => {
    const cond: TriggerCondition = {
      all: [
        { metric: "approval", op: "lt", threshold: 35 },
        { metric: "unemploymentRate", op: "gt", threshold: 8 },
      ],
    };
    expect(
      evaluateCondition(cond, snapshot({ current: { approval: 30, unemploymentRate: 9 } }))
    ).toBe(true);
    expect(
      evaluateCondition(cond, snapshot({ current: { approval: 30, unemploymentRate: 5 } }))
    ).toBe(false);
  });

  it("currency crisis: fx depreciation over a window", () => {
    const cond: TriggerCondition = {
      all: [{ metric: "fxDepreciation", op: "gt", threshold: 15, windowTurns: 6 }],
    };
    expect(evaluateCondition(cond, snapshot({ fxDepreciation: () => 22 }))).toBe(true);
    expect(evaluateCondition(cond, snapshot({ fxDepreciation: () => 5 }))).toBe(false);
    expect(evaluateCondition(cond, snapshot({ fxDepreciation: () => null }))).toBe(false);
  });
});
