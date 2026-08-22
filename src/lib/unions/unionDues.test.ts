import { describe, expect, it } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  duesIncomePerTurn,
  servicesCostPerTurn,
  unionMembers,
  UNION_TREASURY_FLOW_SCALE,
  approvalTarget,
  approvalTargetBreakdown,
  BASE_APPROVAL,
} from "./unionDues";

describe("unionMembers", () => {
  it("counts workers times unionization, so a drive that raises density raises headcount", () => {
    const shop = { workers: 500, unionization: 10 };
    expect(unionMembers([shop])).toBe(50);
    expect(unionMembers([{ ...shop, unionization: 13 }])).toBe(65);
  });

  it("ignores shops with no workers or no density", () => {
    expect(unionMembers([{ workers: 0, unionization: 80 }])).toBe(0);
    expect(unionMembers([{ workers: 500, unionization: 0 }])).toBe(0);
  });
});

describe("union treasury flow scale", () => {
  it("credits twelve times the annual dues divided by a 48-turn year", () => {
    // 100 members * 4.8 a year / 48 turns = 10, then * 12 = 120.
    expect(TURNS_PER_YEAR).toBe(48);
    expect(UNION_TREASURY_FLOW_SCALE).toBe(12);
    expect(duesIncomePerTurn(100, 4.8)).toBe(120);
  });

  it("bills twelve times the wage-fraction service cost per turn", () => {
    // healthFund is 2.5% of wages: 100 members * 10 wage * 0.025 / 48 = 0.520833..., * 12 = 6.25.
    expect(servicesCostPerTurn(100, 10, ["healthFund"])).toBeCloseTo(6.25, 8);
  });
});

describe("approvalTarget political contributions", () => {
  it("drops 5 points at the 50% cap with no dues and no services", () => {
    const baseline = approvalTarget({
      duesPerWorkerAnnual: 0,
      annualWage: 10,
      activeServices: [],
    });
    const atCap = approvalTarget({
      duesPerWorkerAnnual: 0,
      annualWage: 10,
      activeServices: [],
      politicalContributionPct: 0.5,
    });
    expect(baseline).toBe(BASE_APPROVAL);
    expect(atCap).toBe(BASE_APPROVAL - 5);
  });
});

describe("approvalTargetBreakdown", () => {
  it("explains when service gains are offset by four-percent dues", () => {
    const breakdown = approvalTargetBreakdown({
      duesPerWorkerAnnual: 4,
      annualWage: 100,
      activeServices: ["healthFund", "training"],
      politicalContributionPct: 0,
    });

    expect(breakdown).toEqual({
      base: 55,
      servicesBonus: 19,
      duesPenalty: 20,
      politicalPenalty: 0,
      target: 54,
    });
    expect(
      approvalTarget({
        duesPerWorkerAnnual: 4,
        annualWage: 100,
        activeServices: ["healthFund", "training"],
        politicalContributionPct: 0,
      })
    ).toBe(breakdown.target);
  });
});
