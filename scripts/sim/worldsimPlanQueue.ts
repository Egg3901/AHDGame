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
      _id: `plan_${arm.fingerprint.slice(0, 36)}_a${plan.attempt}`,
      status: "queued" as const,
      mode: "full-budgeted-v1",
      actors: "pure-npp",
      preset: plan.preset,
      turns: plan.turns,
      seed: plan.seed,
      dbName: `ahd_sim_plan_${arm.fingerprint.slice(0, 28)}_a${plan.attempt}`,
      cloneFromLive: false,
      sourceCommit: arm.sourceCommit,
      sourceWorktree: arm.sourceWorktree,
      engineBudgetSeconds: arm.engineBudgetSeconds,
      startPolicy: "window" as const,
      plannerFingerprint: arm.fingerprint,
      plannerRuntime: plan.runtime,
      plannerAttempt: plan.attempt,
      plannerQuestion: plan.question,
      createdAt: now,
      updatedAt: now,
    }));
}

export function assertPlannerRuntime(
  job: { mode?: string; plannerRuntime?: string },
  runtime: string
): void {
  if (job.mode === "full-budgeted-v1" && job.plannerRuntime !== runtime)
    throw new Error(
      "Budgeted plan runtime differs from this worker; replan with the correct runtime"
    );
}

export function assertExistingJobCompatible(
  existing: Record<string, unknown> | null,
  planned: ReturnType<typeof plannedJobs>[number]
): void {
  if (!existing) return;
  for (const field of [
    "mode",
    "sourceCommit",
    "sourceWorktree",
    "engineBudgetSeconds",
    "plannerRuntime",
  ] as const) {
    if (existing[field] !== planned[field])
      throw new Error(
        `Existing job ${planned._id} has different execution limits or source binding; choose a new explicit attempt`
      );
  }
}
