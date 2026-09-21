export type ObligationPriority = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type DepartmentProgramStatus = "authorized" | "operating" | "winding_down" | "closed";

export type DepartmentBindingConstraint = "funding" | "capacity" | "coverage" | "ramp" | "none";

export interface CapacitySourceBreakdown {
  workforce: number;
  facilities: number;
  systems: number;
  efficiency: number;
}

export interface CapacityPoolInput {
  capacityType: string;
  maintenanceDemand: number;
  programDemand: number;
  sourceBreakdown: CapacitySourceBreakdown;
}

export interface CapacitySettlement {
  capacityType: string;
  grossThroughput: number;
  maintainedThroughput: number;
  maintenanceDemand: number;
  programDemand: number;
  ratio: number;
  sourceBreakdown: CapacitySourceBreakdown;
}

export interface PriorityClaim {
  id: string;
  priority: ObligationPriority;
  requested: number;
  /**
   * Optional player-authored share inside this legal priority tier. This never
   * moves a claim ahead of arrears or existing commitments.
   */
  allocationWeight?: number;
}

export interface PriorityAllocation {
  id: string;
  priority: ObligationPriority;
  requested: number;
  allocated: number;
}

export interface ImplementationFactors {
  fundingRatio: number;
  capacityRatio: number;
  coverageRatio: number;
  rampFactor: number;
}

export interface ImplementationSettlement extends ImplementationFactors {
  implementationFactor: number;
  bindingConstraint: DepartmentBindingConstraint;
}

export interface ProgramAccountInput {
  programId: string;
  legislationTypeId: string;
  policyOptionId: string;
  status: DepartmentProgramStatus;
  priority: ObligationPriority;
  openingBalance: number;
  openingEncumbered: number;
  accruedThroughTurn: number;
  turn: number;
  authority: number;
  programDemand: number;
  requestedOutlay: number;
  requestedEncumbrance: number;
  capacity: CapacityPoolInput;
  coverageRatio: number;
  rampFactor: number;
  repealTurn?: number;
}

export interface ProgramAccountSettlement {
  programId: string;
  legislationTypeId: string;
  policyOptionId: string;
  status: DepartmentProgramStatus;
  replayed: boolean;
  turn: number;
  authorityAccrued: number;
  programDemand: number;
  obligated: number;
  outlaid: number;
  newEncumbrance: number;
  closingBalance: number;
  closingEncumbered: number;
  availableBalance: number;
  arrears: 0;
  capacity: CapacitySettlement;
  implementation: ImplementationSettlement;
  repealTurn?: number;
}

export interface ReconciliationResult {
  ok: boolean;
  failures: string[];
}

export interface DepartmentProgramClaimInput {
  programId: string;
  legislationTypeId: string;
  policyOptionId: string;
  status: DepartmentProgramStatus;
  priority: ObligationPriority;
  annualDemand: number;
  periodDemand: number;
  requestedOutlay: number;
  requestedEncumbrance: number;
  openingEncumbered?: number;
  capacity: CapacityPoolInput;
  coverageRatio: number;
  rampFactor: number;
  createsArrearsOnShortfall: boolean;
  /** Optional Cabinet emphasis within the program's legal priority tier. */
  allocationWeight?: number;
  jurisdictionMode?: import("@/lib/db/types/legislation").JurisdictionMode;
  implementationMode?: import("@/lib/db/types/legislation").LawImplementationMode;
  repealTurn?: number;
}

export interface DepartmentAccountPolicyInput {
  canOverdraft: boolean;
  usesEncumbrance: boolean;
  arrearsMode: "none" | "record" | "sovereign_overdraft";
}

export interface DepartmentAccountSettlementInput {
  departmentId: string;
  turn: number;
  accruedThroughTurn: number;
  openingBalance: number;
  openingEncumbered: number;
  openingArrears: number;
  authority: number;
  policy: DepartmentAccountPolicyInput;
  programs: DepartmentProgramClaimInput[];
}

export interface DepartmentProgramClaimSettlement {
  programId: string;
  legislationTypeId: string;
  policyOptionId: string;
  status: DepartmentProgramStatus;
  priority: ObligationPriority;
  annualDemand: number;
  requested: number;
  allocated: number;
  outlaid: number;
  encumbrancePaid: number;
  newEncumbrance: number;
  closingEncumbered: number;
  newArrears: number;
  implementation: ImplementationSettlement;
  capacity: CapacitySettlement;
  jurisdictionMode?: import("@/lib/db/types/legislation").JurisdictionMode;
  implementationMode?: import("@/lib/db/types/legislation").LawImplementationMode;
  repealTurn?: number;
}

export interface DepartmentAccountSettlement {
  departmentId: string;
  turn: number;
  replayed: boolean;
  authorityAccrued: number;
  arrearsPaid: number;
  encumbrancePaid: number;
  programOutlays: number;
  totalOutlays: number;
  newEncumbrance: number;
  newArrears: number;
  overdraft: number;
  closingBalance: number;
  closingEncumbered: number;
  closingArrears: number;
  programs: DepartmentProgramClaimSettlement[];
}
