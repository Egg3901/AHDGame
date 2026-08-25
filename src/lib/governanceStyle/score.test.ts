import { describe, expect, it } from "vitest";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import {
  democraticHealthLabel,
  leftRightLabel,
  scoreGovernanceStyle,
  supportsGovernanceStyle,
} from "./score";
import { assessDemocraticCompetition } from "./competition";

function board(value = 50): Record<PoliticalMetricId, number> {
  return Object.fromEntries(
    POLITICAL_METRIC_FAMILIES.map((family) => [family.id, value])
  ) as Record<PoliticalMetricId, number>;
}

describe("scoreGovernanceStyle", () => {
  it("places a neutral board at the centre of both balances", () => {
    const score = scoreGovernanceStyle(board());
    expect(score.leftRight).toEqual({ value: 50, label: "Centre" });
    expect(score.democraticHealth).toEqual({ value: 50, label: "Fragile democracy" });
  });

  it("is symmetric between mirrored left and right policy outcomes", () => {
    const left = board();
    const right = board();
    for (const family of POLITICAL_METRIC_FAMILIES) {
      if (family.categoryId === "governance" || family.categoryId === "order") continue;
      if (family.lean < 0) {
        left[family.id] = 100;
        right[family.id] = 0;
      } else if (family.lean > 0) {
        left[family.id] = 0;
        right[family.id] = 100;
      }
    }
    const leftScore = scoreGovernanceStyle(left).leftRight.value;
    const rightScore = scoreGovernanceStyle(right).leftRight.value;
    expect(leftScore).toBeLessThan(10);
    expect(rightScore).toBeGreaterThan(90);
    expect(leftScore + rightScore).toBe(100);
  });

  it("makes a moderate mirrored advantage legible on the balance", () => {
    const values = board();
    values["economy.workerSecurity"] = 40;
    values["economy.competition"] = 60;
    expect(scoreGovernanceStyle(values).leftRight.value).toBeGreaterThan(50);
  });

  it("moves democratic health without moving political direction", () => {
    const failing = board();
    const healthy = board();
    for (const id of [
      "governance.participation",
      "governance.openness",
      "governance.integrity",
      "governance.administration",
      "order.dueProcess",
      "order.courts",
      "order.communityTrust",
      "order.safety",
      "society.civicLife",
    ] as PoliticalMetricId[]) {
      failing[id] = 0;
      healthy[id] = 100;
    }

    const low = scoreGovernanceStyle(failing);
    const high = scoreGovernanceStyle(healthy);
    expect(low.democraticHealth.value).toBe(0);
    expect(high.democraticHealth.value).toBe(100);
    expect(low.leftRight.value).toBe(high.leftRight.value);
  });

  it("applies party dominance only to democratic health", () => {
    const values = board(70);
    const baseline = scoreGovernanceStyle(values);
    const competition = assessDemocraticCompetition({ seatsByParty: { dem: 75, rep: 25 } });
    const dominated = scoreGovernanceStyle(values, competition);
    expect(dominated.leftRight).toEqual(baseline.leftRight);
    expect(dominated.democraticHealth.value).toBe(
      baseline.democraticHealth.value - competition.penalty
    );
  });

  it("ignores missing and non-finite values and clamps supplied health inputs", () => {
    expect(
      scoreGovernanceStyle({
        "governance.participation": 150,
        "governance.openness": Number.NaN,
      }).democraticHealth.value
    ).toBe(100);
    expect(scoreGovernanceStyle({}).leftRight.value).toBe(50);
  });
});

describe("Governance Style labels and applicability", () => {
  it("uses stable bands", () => {
    expect(leftRightLabel(19.9)).toBe("Left");
    expect(leftRightLabel(50)).toBe("Centre");
    expect(leftRightLabel(80.1)).toBe("Right");
    expect(democraticHealthLabel(19.9)).toBe("Failed state");
    expect(democraticHealthLabel(80)).toBe("Healthy democracy");
  });

  it("stays separate from one-party-state mechanics", () => {
    expect(supportsGovernanceStyle("presidential")).toBe(true);
    expect(supportsGovernanceStyle("parliamentaryMonarchy")).toBe(true);
    expect(supportsGovernanceStyle("parliamentaryRepublic")).toBe(true);
    expect(supportsGovernanceStyle("onePartyState")).toBe(false);
  });
});
