import { describe, expect, it } from "vitest";
import type { GoverningGoalRecord } from "../../v5/rules/governingGoals";
import {
  GOAL_PROGRESS_MARGIN,
  judgeMinisterOnGoals,
  reshuffleThresholdMet,
} from "./ministerGoalJudgement";

function goal(over: Partial<GoverningGoalRecord> = {}): GoverningGoalRecord {
  return {
    domain: "economic_growth",
    direction: "raise",
    target: 60,
    priority: 1,
    status: "active",
    openedTurn: 90,
    reviewedTurn: 90,
    openingAttainment: 0.5,
    attainment: 0.5,
    strikes: 0,
    ...over,
  };
}

const brief = new Set(["economic_growth", "employment"]);

describe("ministers judged on their goal (v6)", () => {
  it("falls back to the shortfall rule when no goal covers the brief", () => {
    const judged = judgeMinisterOnGoals({
      domains: brief,
      goals: [goal({ domain: "healthcare", strikes: 2 })],
      domainHealth: {},
      appointedTurn: 10,
    });
    expect(judged.verdict).toBe("shortfall");
    expect(reshuffleThresholdMet(judged, true)).toBe(true);
    expect(reshuffleThresholdMet(judged, false)).toBe(false);
  });

  it("keeps a minister making progress, even on a failing domain", () => {
    // Health 36 of 60 is a 40% shortfall, but attainment rose from 0.5 to 0.6.
    const judged = judgeMinisterOnGoals({
      domains: brief,
      goals: [goal({ strikes: 1 })],
      domainHealth: { economic_growth: 36 },
      appointedTurn: 10,
    });
    expect(judged).toEqual({ verdict: "goal-progress", domain: "economic_growth" });
    expect(reshuffleThresholdMet(judged, true)).toBe(false);
  });

  it("does not count gains under the V5 progress margin", () => {
    const health = 60 * (0.5 + GOAL_PROGRESS_MARGIN / 2);
    const judged = judgeMinisterOnGoals({
      domains: brief,
      goals: [goal()],
      domainHealth: { economic_growth: health },
      appointedTurn: 10,
    });
    expect(judged.verdict).toBe("shortfall");
  });

  it("makes a minister in post for a struck goal with no recovery a candidate", () => {
    const judged = judgeMinisterOnGoals({
      domains: brief,
      goals: [goal({ strikes: 1, openingAttainment: 0.9, attainment: 0.9 })],
      domainHealth: { economic_growth: 54 },
      appointedTurn: 90,
    });
    expect(judged).toEqual({ verdict: "goal-failed", domain: "economic_growth" });
    expect(reshuffleThresholdMet(judged, false)).toBe(true);
  });

  it("does not blame a minister appointed after the strike", () => {
    const judged = judgeMinisterOnGoals({
      domains: brief,
      goals: [goal({ strikes: 1 })],
      domainHealth: { economic_growth: 30 },
      appointedTurn: 91,
    });
    expect(judged.verdict).toBe("shortfall");
  });

  it("treats a legacy unstamped seat as in post", () => {
    const judged = judgeMinisterOnGoals({
      domains: brief,
      goals: [goal({ strikes: 1 })],
      domainHealth: { economic_growth: 30 },
      appointedTurn: null,
    });
    expect(judged.verdict).toBe("goal-failed");
  });

  it("lets a failure on one goal outrank progress on another", () => {
    const judged = judgeMinisterOnGoals({
      domains: brief,
      goals: [goal({ domain: "employment", openingAttainment: 0.2 }), goal({ strikes: 2 })],
      domainHealth: { economic_growth: 30, employment: 30 },
      appointedTurn: 10,
    });
    expect(judged).toEqual({ verdict: "goal-failed", domain: "economic_growth" });
  });

  it("uses the last reviewed attainment when health is unmeasured", () => {
    const judged = judgeMinisterOnGoals({
      domains: brief,
      goals: [goal({ strikes: 1, attainment: 0.7 })],
      domainHealth: {},
      appointedTurn: 10,
    });
    expect(judged.verdict).toBe("goal-progress");
  });
});
