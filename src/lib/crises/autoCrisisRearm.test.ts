import { describe, it, expect } from "vitest";
import type { NationalSnapshot } from "./autoCrisisConditions";
import { clauseCleared, conditionCleared, evaluateCondition } from "./autoCrisisConditions";
import { isArmed } from "./autoCrisisCooldown";
import type { CrisisAutoCooldown } from "@/lib/db/types/crisis";
import {
  POWER_GRID_FAILURE_TEMPLATE,
  RECESSION_TEMPLATE,
  INFLATION_SPIKE_TEMPLATE,
  CURRENCY_CRISIS_TEMPLATE,
  MASS_PROTESTS_TEMPLATE,
  COUP_ATTEMPT_TEMPLATE,
} from "./templates";
import {
  BOARD_DELTA_CAP,
  BOARD_TICK_DELTA_CAP,
  boardDeltaForLegacyEffect,
} from "@/lib/politicalLegislation/legacyEffectBridge";
import { MIN_CRISIS_DURATION_TURNS } from "./crisisDuration";
import { legacyValueFromPoliticalScore } from "@/lib/politicalMetrics/derive/legacyInversion";

function snap(current: NationalSnapshot["current"], dep: number | null = null): NationalSnapshot {
  return {
    countryId: "US",
    current,
    histories: {},
    fxDepreciation: () => dep,
  };
}

describe("trigger hysteresis (ticket #1129)", () => {
  const gridClause = {
    metric: "powerGridReliability" as const,
    op: "lt" as const,
    threshold: 90,
    clearMargin: 2,
  };

  it("does not clear while the metric sits under the trigger", () => {
    expect(clauseCleared(gridClause, snap({ powerGridReliability: 40 }))).toBe(false);
    expect(clauseCleared(gridClause, snap({ powerGridReliability: 89 }))).toBe(false);
  });

  it("does not clear inside the hysteresis band", () => {
    // Above the trigger but not yet past the clear line: still latched.
    expect(clauseCleared(gridClause, snap({ powerGridReliability: 91 }))).toBe(false);
  });

  it("clears once the metric recovers past threshold + clearMargin", () => {
    expect(clauseCleared(gridClause, snap({ powerGridReliability: 92 }))).toBe(true);
    expect(clauseCleared(gridClause, snap({ powerGridReliability: 99 }))).toBe(true);
  });

  it("treats an absent metric as NOT cleared, so a template stays latched", () => {
    expect(clauseCleared(gridClause, snap({}))).toBe(false);
  });

  it("clears a greater-than clause on the low side", () => {
    const infl = {
      metric: "inflationRate" as const,
      op: "gt" as const,
      threshold: 7,
      clearMargin: 1,
    };
    expect(clauseCleared(infl, snap({ inflationRate: 8 }))).toBe(false);
    expect(clauseCleared(infl, snap({ inflationRate: 6.5 }))).toBe(false);
    expect(clauseCleared(infl, snap({ inflationRate: 6 }))).toBe(true);
  });

  it("clears an fxDepreciation clause from the window reading", () => {
    const fx = {
      metric: "fxDepreciation" as const,
      op: "gt" as const,
      threshold: 15,
      windowTurns: 6,
      clearMargin: 5,
    };
    expect(clauseCleared(fx, snap({}, 20))).toBe(false);
    expect(clauseCleared(fx, snap({}, 9))).toBe(true);
    expect(clauseCleared(fx, snap({}, null))).toBe(false);
  });

  it("a condition clears as soon as any one clause clears", () => {
    const cond = POWER_GRID_FAILURE_TEMPLATE.autoTrigger!;
    if (cond.kind !== "condition") throw new Error("expected a condition trigger");
    expect(conditionCleared(cond.condition, snap({ powerGridReliability: 50 }))).toBe(false);
    expect(conditionCleared(cond.condition, snap({ powerGridReliability: 95 }))).toBe(true);
  });

  it("trigger and clear are mutually exclusive with a gap between them", () => {
    const cond = POWER_GRID_FAILURE_TEMPLATE.autoTrigger!;
    if (cond.kind !== "condition") throw new Error("expected a condition trigger");
    for (const v of [50, 89, 89.9, 91, 92, 99]) {
      const s = snap({ powerGridReliability: v });
      expect(evaluateCondition(cond.condition, s) && conditionCleared(cond.condition, s)).toBe(
        false
      );
    }
  });

  it("every condition-tier template carries a clearMargin", () => {
    for (const t of [
      POWER_GRID_FAILURE_TEMPLATE,
      RECESSION_TEMPLATE,
      INFLATION_SPIKE_TEMPLATE,
      CURRENCY_CRISIS_TEMPLATE,
      MASS_PROTESTS_TEMPLATE,
      COUP_ATTEMPT_TEMPLATE,
    ]) {
      const trig = t.autoTrigger!;
      if (trig.kind !== "condition") throw new Error(`${t.name} lost its condition trigger`);
      for (const clause of trig.condition.all) {
        expect(clause.clearMargin, `${t.name}/${clause.metric}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("armed latch", () => {
  const row = (armed?: boolean): Map<string, CrisisAutoCooldown> =>
    new Map([
      [
        "POWER_GRID_FAILURE:US",
        {
          _id: "POWER_GRID_FAILURE:US",
          templateKey: "POWER_GRID_FAILURE",
          scopeKey: "US",
          lastSpawnTurn: 1,
          armed,
          updatedAt: new Date(),
        },
      ],
    ]);

  it("reads a missing row as armed", () => {
    expect(isArmed(new Map(), "POWER_GRID_FAILURE", "US")).toBe(true);
  });

  it("reads a legacy row with no armed field as armed", () => {
    expect(isArmed(row(undefined), "POWER_GRID_FAILURE", "US")).toBe(true);
  });

  it("blocks a disarmed template", () => {
    expect(isArmed(row(false), "POWER_GRID_FAILURE", "US")).toBe(false);
    expect(isArmed(row(true), "POWER_GRID_FAILURE", "US")).toBe(true);
  });
});

describe("recurring board deltas cannot annihilate a family", () => {
  it("spends at most one BOARD_DELTA_CAP across a full-length crisis", () => {
    expect(BOARD_TICK_DELTA_CAP * MIN_CRISIS_DURATION_TURNS).toBeCloseTo(BOARD_DELTA_CAP, 10);
  });

  it("caps the grid-collapse tick far below the 12-point one-shot cap", () => {
    // -0.15 authored swing x CRISIS_TICK_UNIT_SCALE 30 = -4.5 native, which the
    // 2.9-point quality band would otherwise amplify to -155 board points.
    const hit = boardDeltaForLegacyEffect(
      "infrastructure",
      "powerGridReliability",
      -4.5,
      undefined,
      BOARD_TICK_DELTA_CAP
    )!;
    expect(hit.scoreDelta).toBe(-BOARD_TICK_DELTA_CAP);
    expect(Math.abs(hit.scoreDelta) * MIN_CRISIS_DURATION_TURNS).toBeLessThanOrEqual(
      BOARD_DELTA_CAP
    );
  });

  it("leaves a grid crisis unable to drive utilities under its own trigger floor", () => {
    // Worst case: full strength on every turn, no ramp-down. A board that fired
    // the crisis at 89.9 still lands well clear of zero, so the crisis stops
    // being the reason its own trigger is true.
    const worstCase = 89.9 - BOARD_TICK_DELTA_CAP * MIN_CRISIS_DURATION_TURNS;
    expect(worstCase).toBeGreaterThan(75);
  });

  it("still allows the full cap for one-off shocks", () => {
    const hit = boardDeltaForLegacyEffect("infrastructure", "powerGridReliability", -4.5)!;
    expect(hit.scoreDelta).toBe(-BOARD_DELTA_CAP);
  });
});

describe("grid trigger reads uptime, not the family score (ticket #1129)", () => {
  const cond = (() => {
    const t = POWER_GRID_FAILURE_TEMPLATE.autoTrigger!;
    if (t.kind !== "condition") throw new Error("expected a condition trigger");
    return t.condition;
  })();
  const era = { countryId: "US", year: 1956 };
  const uptime = (score: number) =>
    legacyValueFromPoliticalScore("infrastructure", "powerGridReliability", score, era)!;

  it("leaves an ordinary utilities score well clear of the trigger", () => {
    // The healthy live band for this family is roughly 55-80. Read as a raw
    // score every one of those countries was permanently "in a grid collapse".
    for (const score of [55, 65, 78, 80]) {
      expect(uptime(score)).toBeGreaterThan(90);
      expect(evaluateCondition(cond, snap({ powerGridReliability: uptime(score) }))).toBe(false);
    }
  });

  it("still fires for a genuinely collapsed grid", () => {
    expect(uptime(0)).toBeLessThan(90);
    expect(evaluateCondition(cond, snap({ powerGridReliability: uptime(0) }))).toBe(true);
  });

  it("keeps the clear line reachable from a normal score", () => {
    // clearMargin 2 over a threshold of 90 means re-arming needs 92 percent
    // uptime, which an ordinary board reaches. A latch nothing can clear would
    // just be a permanent switch-off dressed up as hysteresis.
    expect(conditionCleared(cond, snap({ powerGridReliability: uptime(60) }))).toBe(true);
  });
});
