/**
 * UK regional executives exist only in an established settlement.
 * A national devolution law can found, retain, abolish or restore the offices;
 * founding fixes the first election anchor instead of inheriting US midterms.
 */
export const UK_EXECUTIVE_REGIONS = ["SCO", "WAL", "NIR", "LON"] as const;
export type UKExecutiveRegion = (typeof UK_EXECUTIVE_REGIONS)[number];

export interface RegionalExecutiveInstitution {
  active: boolean;
  firstCycle: number;
  firstElectionEndTurn?: number;
}

export interface UKDevolutionState {
  _id: "UK";
  regions: Record<UKExecutiveRegion, RegionalExecutiveInstitution>;
  lastPolicyBillId?: string;
  /** Optional live peace-process ownership. Missing preserves existing worlds. */
  northernIrelandPeace?: {
    posture: "unsettled" | "power_sharing" | "suspended";
    changedTurn: number;
    assemblyFirstCycle?: number;
    assemblyFirstElectionEndTurn?: number;
  };
}

export interface EnactedDevolutionPolicy {
  billId: string;
  optionIndex: number;
  enactedTurn: number;
}

export function initialUKDevolutionState(startingYear: number): UKDevolutionState {
  return {
    _id: "UK",
    regions: {
      SCO: { active: startingYear >= 1999, firstCycle: 1 },
      WAL: { active: startingYear >= 1999, firstCycle: 1 },
      NIR: { active: startingYear >= 1999, firstCycle: 1 },
      LON: { active: startingYear >= 2000, firstCycle: 1 },
    },
  };
}

export function applyUKDevolutionPolicy(
  state: UKDevolutionState,
  policy: EnactedDevolutionPolicy | null,
  latestCycles: Partial<Record<UKExecutiveRegion, number>>,
  firstElectionWindow: number
): UKDevolutionState {
  if (!policy || policy.billId === state.lastPolicyBillId) return state;
  if (!Number.isInteger(policy.optionIndex) || policy.optionIndex < 0 || policy.optionIndex > 6) {
    return state;
  }
  const next = structuredClone(state);
  next.lastPolicyBillId = policy.billId;
  for (const region of UK_EXECUTIVE_REGIONS) {
    const current = state.regions[region];
    if (policy.optionIndex === 6) {
      next.regions[region] = { ...current, active: false };
    } else if (policy.optionIndex <= 3 && !current.active) {
      next.regions[region] = {
        active: true,
        firstCycle: (latestCycles[region] ?? 0) + 1,
        firstElectionEndTurn: policy.enactedTurn + firstElectionWindow,
      };
    }
    // Primacy and rollback restrict powers but do not abolish an existing office.
  }
  return next;
}

export function executiveCycleAnchor(
  institution: RegionalExecutiveInstitution,
  cyclePeriod: number
): number | undefined {
  return institution.firstElectionEndTurn === undefined
    ? undefined
    : institution.firstElectionEndTurn - (institution.firstCycle - 1) * cyclePeriod;
}

export function usesUKDevolution(countryId: string): boolean {
  // eslint-disable-next-line local/no-country-literals -- this module owns the UK statutory settlement, not a shared capability
  return countryId === "UK";
}
