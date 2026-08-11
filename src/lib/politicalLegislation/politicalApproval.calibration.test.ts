import { describe, expect, it } from "vitest";
import { NATIONAL_BASELINES_1953 } from "@/lib/politicalMetrics/seeds/nationalBaselines1953";
import { POLITICAL_METRIC_COUNTRY_IDS, type PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { APPROVAL_POINTS_PER_SCORE, approvalComponent } from "./politicalApproval";

function baselineBoard(cc: (typeof POLITICAL_METRIC_COUNTRY_IDS)[number]) {
  const board = {} as Record<PoliticalMetricId, number>;
  for (const [id, b] of Object.entries(NATIONAL_BASELINES_1953[cc])) {
    board[id as PoliticalMetricId] = b.value;
  }
  return board;
}

describe("approval calibration (spec §2 two-parameter, §6 day-one golden)", () => {
  it("day-one 1953 seed boards produce a ~zero component for every playable country", () => {
    for (const cc of POLITICAL_METRIC_COUNTRY_IDS) {
      // Neutral scores are the blend rounded to 0.01, so the residual is < 0.005
      // per term; keep a small envelope for the 70/30 recombination.
      expect(Math.abs(approvalComponent(baselineBoard(cc), 0, cc))).toBeLessThan(0.05);
    }
  });

  it("a uniform board improvement moves the component by points-per-score exactly", () => {
    for (const cc of POLITICAL_METRIC_COUNTRY_IDS) {
      const board = baselineBoard(cc);
      const lifted = { ...board };
      for (const id of Object.keys(lifted) as PoliticalMetricId[]) lifted[id] = board[id] + 10;
      const delta = approvalComponent(lifted, 0, cc) - approvalComponent(board, 0, cc);
      expect(delta).toBeCloseTo(10 * APPROVAL_POINTS_PER_SCORE, 6);
    }
  });
});
