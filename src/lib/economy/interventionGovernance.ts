import { z } from "zod";

const metricRuleSchema = z.object({
  metric: z.string().min(1).max(120),
  direction: z.enum(["increase", "decrease"]),
  minimumImprovement: z.number().nonnegative(),
});

const guardrailSchema = z.object({
  metric: z.string().min(1).max(120),
  direction: z.enum(["increase", "decrease"]),
  maximumDeterioration: z.number().nonnegative(),
});

export const economicInterventionPlanSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    issueId: z.number().int().positive(),
    owner: z.string().min(1).max(120),
    objective: z.string().min(1).max(500),
    targets: z.array(metricRuleSchema).min(1).max(12),
    guardrails: z.array(guardrailSchema).min(1).max(12),
    cohort: z.object({
      initialShare: z.number().min(0).max(1),
      maximumShare: z.number().min(0).max(1),
      rampTurns: z.number().int().positive().max(10_000),
    }),
    review: z.object({
      startTurn: z.number().int().nonnegative(),
      reviewTurn: z.number().int().positive(),
    }),
    rollback: z.object({
      owner: z.string().min(1).max(120),
      trigger: z.string().min(1).max(500),
      action: z.string().min(1).max(500),
    }),
  })
  .superRefine((plan, ctx) => {
    if (plan.cohort.maximumShare < plan.cohort.initialShare) {
      ctx.addIssue({
        code: "custom",
        path: ["cohort", "maximumShare"],
        message: "maximumShare must be at least initialShare",
      });
    }
    if (plan.review.reviewTurn <= plan.review.startTurn) {
      ctx.addIssue({
        code: "custom",
        path: ["review", "reviewTurn"],
        message: "reviewTurn must be after startTurn",
      });
    }
  });

export type EconomicInterventionPlan = z.infer<typeof economicInterventionPlanSchema>;

export type InterventionMetricValues = Record<string, number | null | undefined>;

export interface InterventionAssessment {
  decision: "continue" | "review" | "rollback";
  targetResults: Array<{ metric: string; improvement: number | null; met: boolean }>;
  guardrailResults: Array<{ metric: string; deterioration: number | null; breached: boolean }>;
  reasons: string[];
}

function directedChange(
  baseline: number | null | undefined,
  current: number | null | undefined,
  direction: "increase" | "decrease"
): number | null {
  if (baseline == null || current == null) return null;
  return direction === "increase" ? current - baseline : baseline - current;
}

export function validateInterventionActivation(
  plan: EconomicInterventionPlan,
  currentTurn: number
): string | null {
  if (plan.review.startTurn > currentTurn) return "intervention startTurn is in the future";
  if (plan.review.reviewTurn <= currentTurn) return "intervention reviewTurn must be in the future";
  return null;
}

export function assessEconomicIntervention(
  plan: EconomicInterventionPlan,
  baseline: InterventionMetricValues,
  current: InterventionMetricValues,
  currentTurn: number
): InterventionAssessment {
  const targetResults = plan.targets.map((target) => {
    const improvement = directedChange(
      baseline[target.metric],
      current[target.metric],
      target.direction
    );
    return {
      metric: target.metric,
      improvement,
      met: improvement != null && improvement >= target.minimumImprovement,
    };
  });
  const guardrailResults = plan.guardrails.map((guardrail) => {
    const improvement = directedChange(
      baseline[guardrail.metric],
      current[guardrail.metric],
      guardrail.direction
    );
    const deterioration = improvement == null ? null : Math.max(0, -improvement);
    return {
      metric: guardrail.metric,
      deterioration,
      breached: deterioration != null && deterioration > guardrail.maximumDeterioration,
    };
  });
  const reasons: string[] = [];
  const breached = guardrailResults.filter((result) => result.breached);
  if (breached.length > 0) {
    reasons.push(`guardrail_breached:${breached.map((result) => result.metric).join(",")}`);
    return { decision: "rollback", targetResults, guardrailResults, reasons };
  }
  const missingTargetCount = targetResults.filter((result) => result.improvement == null).length;
  const missingGuardrailCount = guardrailResults.filter(
    (result) => result.deterioration == null
  ).length;
  if (missingTargetCount + missingGuardrailCount > 0) reasons.push("metric_sample_incomplete");
  if (currentTurn >= plan.review.reviewTurn) {
    const missed = targetResults.filter((result) => !result.met);
    if (missed.length > 0) {
      reasons.push(`target_missed:${missed.map((result) => result.metric).join(",")}`);
      return { decision: "rollback", targetResults, guardrailResults, reasons };
    }
    reasons.push("scheduled_review_due");
    return { decision: "review", targetResults, guardrailResults, reasons };
  }
  return { decision: "continue", targetResults, guardrailResults, reasons };
}
