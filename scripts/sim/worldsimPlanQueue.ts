/** Budgeted plans use the existing queue and never clone a live world. */
import type { WorldsimPlan } from "./worldsimPlan";
import { canClaimAt } from "./claimWindow";
export function budgetedJobWindowFilter(now: Date): { mode?: { $ne: "full-budgeted-v1" } } {
  return canClaimAt(now, { startHour: 3, endHour: 8, timeZone: "America/New_York" })
    ? {}
    : { mode: { $ne: "full-budgeted-v1" } };
}
export function plannedJobs(plan: WorldsimPlan, now: Date) {
  if (plan.status !== "ready") throw new Error("Only an admitted plan can enqueue");
  return plan.arms
    .filter((a) => !a.reusedReport)
    .map((arm) => ({
      _id: `plan_${arm.fingerprint.slice(0, 40)}`,
      status: "queued" as const,
      mode: "full-budgeted-v1",
      actors: "pure-npp",
      preset: plan.preset,
      turns: plan.turns,
      seed: plan.seed,
      dbName: `ahd_sim_plan_${arm.fingerprint.slice(0, 32)}`,
      cloneFromLive: false,
      sourceCommit: arm.sourceCommit,
      sourceWorktree: arm.sourceWorktree,
      engineBudgetSeconds: arm.engineBudgetSeconds,
      startPolicy: "window" as const,
      plannerFingerprint: arm.fingerprint,
      plannerQuestion: plan.question,
      createdAt: now,
      updatedAt: now,
    }));
}
