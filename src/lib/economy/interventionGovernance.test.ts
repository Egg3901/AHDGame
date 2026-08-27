import { describe, expect, it } from "vitest";
import {
  assessEconomicIntervention,
  economicInterventionPlanSchema,
  validateInterventionActivation,
  type EconomicInterventionPlan,
} from "./interventionGovernance";

const plan: EconomicInterventionPlan = {
  id: "issue-968-shortage-sourcing",
  issueId: 968,
  owner: "economy-operator",
  objective: "Increase buyer intent fulfillment without weakening sell-through.",
  targets: [
    {
      metric: "intentFulfillmentRate",
      direction: "increase",
      minimumImprovement: 0.05,
    },
  ],
  guardrails: [
    {
      metric: "physicalSellThrough",
      direction: "increase",
      maximumDeterioration: 0.05,
    },
  ],
  cohort: { initialShare: 0.1, maximumShare: 1, rampTurns: 24 },
  review: { startTurn: 435, reviewTurn: 483 },
  rollback: {
    owner: "economy-operator",
    trigger: "A guardrail breaches or the target is missed at review.",
    action: "Disable shortage-responsive sourcing.",
  },
};

describe("economic intervention governance", () => {
  it("rejects an inverted cohort and review window", () => {
    const parsed = economicInterventionPlanSchema.safeParse({
      ...plan,
      cohort: { initialShare: 0.8, maximumShare: 0.4, rampTurns: 1 },
      review: { startTurn: 500, reviewTurn: 499 },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects activation when review is not prospective", () => {
    expect(validateInterventionActivation(plan, 483)).toBe(
      "intervention reviewTurn must be in the future"
    );
  });

  it("rolls back immediately when a guardrail breaches", () => {
    const assessment = assessEconomicIntervention(
      plan,
      { intentFulfillmentRate: 0.5, physicalSellThrough: 0.9 },
      { intentFulfillmentRate: 0.58, physicalSellThrough: 0.84 },
      450
    );
    expect(assessment.decision).toBe("rollback");
    expect(assessment.reasons).toEqual(["guardrail_breached:physicalSellThrough"]);
  });

  it("calls for review when targets and guardrails pass at the review turn", () => {
    const assessment = assessEconomicIntervention(
      plan,
      { intentFulfillmentRate: 0.5, physicalSellThrough: 0.9 },
      { intentFulfillmentRate: 0.56, physicalSellThrough: 0.89 },
      483
    );
    expect(assessment.decision).toBe("review");
    expect(assessment.reasons).toEqual(["scheduled_review_due"]);
  });
});
