export interface DepartmentAllocationValidation {
  ok: boolean;
  error?: string;
}

export function validateDepartmentProgramAllocations(
  activeProgramIds: readonly string[],
  allocations: Readonly<Record<string, number>>
): DepartmentAllocationValidation {
  const expected = [...new Set(activeProgramIds)].sort();
  const received = Object.keys(allocations).sort();
  if (
    expected.length !== received.length ||
    expected.some((programId, index) => programId !== received[index])
  ) {
    return { ok: false, error: "Allocations must include every active department program." };
  }
  for (const [programId, value] of Object.entries(allocations)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return {
        ok: false,
        error: `Allocation for ${programId} must be between 0 and 100.`,
      };
    }
  }
  const total = Object.values(allocations).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 0.1) {
    return {
      ok: false,
      error: `Allocations must sum to 100%. Current total: ${total.toFixed(1)}%.`,
    };
  }
  return { ok: true };
}
