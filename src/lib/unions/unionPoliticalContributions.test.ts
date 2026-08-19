import { describe, expect, it } from "vitest";
import {
  MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY,
  MAX_POLITICAL_CONTRIBUTION_OF_FCF,
  clampPoliticalContributionPct,
  distributePoliticalContributions,
  freeCashFlowPerTurn,
  politicalContributionApprovalPenalty,
  politicalContributionPerTurn,
} from "./unionPoliticalContributions";

describe("clampPoliticalContributionPct", () => {
  it("passes a rate inside the 50% cap", () => {
    expect(clampPoliticalContributionPct(0.4)).toBe(0.4);
  });

  it("caps at half of free cash flow", () => {
    expect(MAX_POLITICAL_CONTRIBUTION_OF_FCF).toBe(0.5);
    expect(clampPoliticalContributionPct(0.8)).toBe(0.5);
  });

  it("treats missing, negative, or non-finite rates as none", () => {
    expect(clampPoliticalContributionPct(undefined)).toBe(0);
    expect(clampPoliticalContributionPct(-0.2)).toBe(0);
    expect(clampPoliticalContributionPct(Number.NaN)).toBe(0);
    expect(clampPoliticalContributionPct(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("freeCashFlowPerTurn", () => {
  it("is dues income minus the service bill that ran", () => {
    expect(freeCashFlowPerTurn(120, 20)).toBe(100);
  });

  it("is zero when services consume the surplus, so contributions cannot spend the stock", () => {
    expect(freeCashFlowPerTurn(20, 120)).toBe(0);
    expect(freeCashFlowPerTurn(0, 0)).toBe(0);
  });
});

describe("politicalContributionPerTurn", () => {
  it("takes the set percentage of this turn's free cash flow, not of the year", () => {
    // 40% of a 100 surplus is 40 this turn. The dues/services figures are
    // already per-turn, so the slider does not divide by TURNS_PER_YEAR again.
    expect(politicalContributionPerTurn(100, 0.4)).toBe(40);
  });

  it("at the cap, spends half the surplus and leaves the rest in the treasury", () => {
    expect(politicalContributionPerTurn(100, 0.5)).toBe(50);
    expect(politicalContributionPerTurn(100, 0.9)).toBe(50);
  });

  it("pays nothing when there is no surplus", () => {
    expect(politicalContributionPerTurn(0, 0.5)).toBe(0);
  });
});

describe("politicalContributionApprovalPenalty", () => {
  it("is zero when the union sends nothing", () => {
    expect(politicalContributionApprovalPenalty(0)).toBe(0);
    expect(politicalContributionApprovalPenalty(undefined)).toBe(0);
  });

  it("is 5 points at the 50% cap, and half that at half the cap", () => {
    expect(MAX_POLITICAL_CONTRIBUTION_APPROVAL_PENALTY).toBe(5);
    expect(politicalContributionApprovalPenalty(0.5)).toBe(5);
    expect(politicalContributionApprovalPenalty(0.25)).toBe(2.5);
  });

  it("does not grow past 5 when a stored rate is above the cap", () => {
    expect(politicalContributionApprovalPenalty(1)).toBe(5);
  });
});

describe("distributePoliticalContributions", () => {
  it("gives an organizer 40% of the pool when they hold 40% of influence", () => {
    const payouts = distributePoliticalContributions(100, [
      { characterId: "a", strength: 40 },
      { characterId: "b", strength: 60 },
    ]);
    const byId = Object.fromEntries(payouts.map((p) => [p.characterId, p.amount]));
    expect(byId.a).toBeCloseTo(40, 10);
    expect(byId.b).toBeCloseTo(60, 10);
  });

  it("credits sum to the debit, including leftover float on the last share", () => {
    const payouts = distributePoliticalContributions(100, [
      { characterId: "a", strength: 1 },
      { characterId: "b", strength: 1 },
      { characterId: "c", strength: 1 },
    ]);
    const sum = payouts.reduce((s, p) => s + p.amount, 0);
    expect(sum).toBeCloseTo(100, 12);
    expect(payouts).toHaveLength(3);
  });

  it("ignores organizers with no strength so they cannot dilute the others", () => {
    const payouts = distributePoliticalContributions(100, [
      { characterId: "idle", strength: 0 },
      { characterId: "active", strength: 10 },
    ]);
    expect(payouts).toEqual([{ characterId: "active", amount: 100 }]);
  });

  it("pays nobody when the pool is empty or nobody has influence", () => {
    expect(distributePoliticalContributions(0, [{ characterId: "a", strength: 10 }])).toEqual([]);
    expect(distributePoliticalContributions(100, [{ characterId: "a", strength: 0 }])).toEqual([]);
    expect(distributePoliticalContributions(100, [])).toEqual([]);
  });
});
