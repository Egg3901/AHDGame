/**
 * Product families share funded corporate budgets. These portable allocators
 * conserve each budget while allowing both families to develop concurrently.
 */
function positive(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Split one paid R&D budget by remaining development cost, with no postlaunch claim. */
export function allocateProductDevelopmentBudget(input: {
  budgetAnchor: number;
  projects: readonly {
    id: string;
    stage: string;
    paidAnchor: number;
    thresholdAnchor: number;
  }[];
}): { byProjectId: Record<string, number>; genericResearchAnchor: number } {
  const needs = input.projects.map((project) => ({
    id: project.id,
    remaining:
      project.stage === "development"
        ? Math.max(0, positive(project.thresholdAnchor) - positive(project.paidAnchor))
        : 0,
  }));
  const total = needs.reduce((sum, project) => sum + project.remaining, 0);
  const budget = positive(input.budgetAnchor);
  const spend = Math.min(budget, total);
  const byProjectId = Object.fromEntries(
    needs.map((project) => [project.id, total > 0 ? (spend * project.remaining) / total : 0])
  );
  return { byProjectId, genericResearchAnchor: budget - spend };
}

/** Combined allocations above 100% share the delivered budget proportionally. */
export function allocateProductAdvertisingBudget(input: {
  deliveredBudgetAnchor: number;
  projects: readonly { id: string; share: number }[];
}): Record<string, number> {
  const claims = input.projects.map((project) => ({
    id: project.id,
    share: Math.min(1, positive(project.share)),
  }));
  const divisor = Math.max(
    1,
    claims.reduce((sum, claim) => sum + claim.share, 0)
  );
  return Object.fromEntries(
    claims.map((claim) => [
      claim.id,
      (positive(input.deliveredBudgetAnchor) * claim.share) / divisor,
    ])
  );
}
