import type { DepartmentAccount } from "@/lib/db/types/budget";
import type { DeliveryMultiplierResolution } from "./deliveryMultiplier";
import { PUBLIC_HEALTH_CAPACITY_TYPE, US_PUBLIC_HEALTH_PROGRAM_ID } from "./departments";
import type { LegislationType } from "@/lib/db/types/legislation";
import type { DepartmentDefinition } from "./departmentCatalog";

export interface DepartmentProgramReadModel {
  enabled: boolean;
  departmentName: string;
  programId?: string;
  programName: string;
  explanation: string;
  status: "not_started" | "authorized" | "operating" | "winding_down" | "closed";
  annualDemand?: number;
  authorityThisTurn?: number;
  availableBalance?: number;
  encumbered?: number;
  outlaid?: number;
  arrears?: number;
  allocationPercent?: number;
  ratios?: {
    funding: number;
    capacity: number;
    coverage: number;
    ramp: number;
    implementation: number;
  };
  bindingConstraint?: "funding" | "capacity" | "coverage" | "ramp" | "none";
  capacity?: {
    availableThroughput: number;
    maintenanceDemand: number;
    workforce: number;
    facilities: number;
    systems: number;
    efficiency: number;
  };
  outcome?: {
    label: string;
    deliveredShare: number;
    reason?: DeliveryMultiplierResolution["reason"];
  };
}

export interface DepartmentFinanceReadModel {
  enabled: boolean;
  departmentId: string;
  departmentName: string;
  kind: DepartmentDefinition["kind"];
  accountPolicyId?: string;
  explanation: string;
  balance?: number;
  availableBalance?: number;
  encumbered?: number;
  arrears?: number;
  lastAllocationChangedTurn?: number;
  programs: DepartmentProgramReadModel[];
}

function metricLabel(metricId: string): string {
  return metricId
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function buildDepartmentFinanceReadModel(input: {
  enabled: boolean;
  definition: DepartmentDefinition;
  departmentName: string;
  account?: DepartmentAccount;
  legislationTypes: LegislationType[];
}): DepartmentFinanceReadModel {
  const base = {
    enabled: input.enabled,
    departmentId: input.definition.id,
    departmentName: input.departmentName,
    kind: input.definition.kind,
    ...(input.definition.accountPolicyId
      ? { accountPolicyId: input.definition.accountPolicyId }
      : {}),
  };
  if (!input.enabled) {
    return {
      ...base,
      explanation: "Department finance is not enabled for this world.",
      programs: [],
    };
  }
  if (!input.account) {
    return {
      ...base,
      explanation: "The department has no settled appropriation account yet.",
      programs: [],
    };
  }

  const typeById = new Map(input.legislationTypes.map((type) => [type._id, type]));
  const programs = Object.values(input.account.programs)
    .sort((a, b) => a.programId.localeCompare(b.programId))
    .map((program): DepartmentProgramReadModel => {
      const type = typeById.get(program.legislationTypeId);
      const option = type?.policyOptions?.find(
        (candidate) => candidate.id === program.policyOptionId
      );
      const capacityType = option?.implementation?.capacityType;
      const capacity = capacityType ? input.account?.capacityPools[capacityType] : undefined;
      const outcome = option?.implementation?.outcome;
      return {
        enabled: true,
        departmentName: input.departmentName,
        programId: program.programId,
        programName: option?.name ?? type?.name ?? program.programId,
        status: program.status,
        explanation:
          "Funding, operating capacity, coverage, and ramp determine this program's delivered share.",
        annualDemand: program.annualDemand,
        authorityThisTurn: program.authorityThisTurn,
        encumbered: program.encumbered ?? 0,
        outlaid: program.outlaid,
        arrears: program.arrears,
        ...(input.account?.programAllocationPercents?.[program.programId] !== undefined
          ? {
              allocationPercent: input.account.programAllocationPercents[program.programId],
            }
          : {}),
        ratios: {
          funding: program.fundingRatio,
          capacity: program.capacityRatio,
          coverage: program.coverageRatio,
          ramp: program.rampFactor,
          implementation: program.implementationFactor,
        },
        bindingConstraint: program.bindingConstraint,
        ...(capacity
          ? {
              capacity: {
                availableThroughput: capacity.availableThroughput,
                maintenanceDemand: capacity.maintenanceDemand,
                workforce: capacity.sourceBreakdown.workforce,
                facilities: capacity.sourceBreakdown.facilities,
                systems: capacity.sourceBreakdown.systems,
                efficiency: capacity.sourceBreakdown.efficiency,
              },
            }
          : {}),
        ...(outcome
          ? {
              outcome: {
                label: metricLabel(outcome.metricId),
                deliveredShare: program.implementationFactor,
              },
            }
          : {}),
      };
    });

  return {
    ...base,
    explanation:
      "The account is a sub-ledger of enacted national spending. Public money remains with the institution when the officeholder changes.",
    balance: input.account.balance,
    availableBalance: Math.max(0, input.account.balance - input.account.encumbered),
    encumbered: input.account.encumbered,
    arrears: input.account.arrears ?? 0,
    ...(input.account.lastAllocationChangedTurn !== undefined
      ? { lastAllocationChangedTurn: input.account.lastAllocationChangedTurn }
      : {}),
    programs,
  };
}

export function buildPublicHealthProgramReadModel(input: {
  enabled: boolean;
  departmentName: string;
  account?: DepartmentAccount;
  delivery: DeliveryMultiplierResolution;
}): DepartmentProgramReadModel {
  const base = {
    enabled: input.enabled,
    departmentName: input.departmentName,
    programName: "Public Health Workforce Expansion",
  } as const;
  if (!input.enabled) {
    return {
      ...base,
      status: "not_started",
      explanation: "Department program accounting is not enabled for this world.",
    };
  }

  const program = input.account?.programs[US_PUBLIC_HEALTH_PROGRAM_ID];
  const capacity = input.account?.capacityPools[PUBLIC_HEALTH_CAPACITY_TYPE];
  if (!input.account || !program || !capacity) {
    return {
      ...base,
      status: "not_started",
      explanation: "No current-turn program settlement is available.",
      outcome: {
        label: "Public Health Preparedness",
        deliveredShare: input.delivery.multiplier,
        reason: input.delivery.reason,
      },
    };
  }

  return {
    ...base,
    status: program.status,
    explanation:
      "Authorization permits the program. Funding, operating capacity, coverage, and ramp determine this turn's delivered share.",
    annualDemand: program.annualDemand,
    authorityThisTurn: program.authorityThisTurn,
    availableBalance: Math.max(0, input.account.balance - input.account.encumbered),
    encumbered: input.account.encumbered,
    outlaid: program.outlaid,
    arrears: program.arrears,
    ratios: {
      funding: program.fundingRatio,
      capacity: program.capacityRatio,
      coverage: program.coverageRatio,
      ramp: program.rampFactor,
      implementation: program.implementationFactor,
    },
    bindingConstraint: program.bindingConstraint,
    capacity: {
      availableThroughput: capacity.availableThroughput,
      maintenanceDemand: capacity.maintenanceDemand,
      workforce: capacity.sourceBreakdown.workforce,
      facilities: capacity.sourceBreakdown.facilities,
      systems: capacity.sourceBreakdown.systems,
      efficiency: capacity.sourceBreakdown.efficiency,
    },
    outcome: {
      label: "Public Health Preparedness",
      deliveredShare: input.delivery.multiplier,
      reason: input.delivery.reason,
    },
  };
}
