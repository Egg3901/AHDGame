/**
 * Department account policies. They decide whether authority carries, lapses,
 * records arrears, or supports contracts without changing program outcomes.
 */
export interface DepartmentAccountPolicy {
  id: string;
  canOverdraft: boolean;
  usesEncumbrance: boolean;
  arrearsMode: "none" | "record" | "sovereign_overdraft";
  carryoverMode: "none" | "capped" | "full";
  lapseMode: "fiscal_year" | "program_end" | "never";
  emergencyAuthority: "none" | "executive" | "legislative";
}

export const DEPARTMENT_ACCOUNT_POLICIES: Record<string, DepartmentAccountPolicy> = {
  civil_operating: {
    id: "civil_operating",
    canOverdraft: false,
    usesEncumbrance: true,
    arrearsMode: "record",
    carryoverMode: "capped",
    lapseMode: "fiscal_year",
    emergencyAuthority: "legislative",
  },
  civil_capital: {
    id: "civil_capital",
    canOverdraft: false,
    usesEncumbrance: true,
    arrearsMode: "record",
    carryoverMode: "full",
    lapseMode: "program_end",
    emergencyAuthority: "legislative",
  },
  civil_demand_led: {
    id: "civil_demand_led",
    canOverdraft: false,
    usesEncumbrance: true,
    arrearsMode: "record",
    carryoverMode: "capped",
    lapseMode: "fiscal_year",
    emergencyAuthority: "legislative",
  },
  defense: {
    id: "defense",
    canOverdraft: true,
    usesEncumbrance: true,
    arrearsMode: "sovereign_overdraft",
    carryoverMode: "full",
    lapseMode: "never",
    emergencyAuthority: "executive",
  },
  intelligence: {
    id: "intelligence",
    canOverdraft: false,
    usesEncumbrance: false,
    arrearsMode: "none",
    carryoverMode: "full",
    lapseMode: "never",
    emergencyAuthority: "executive",
  },
};

export function getDepartmentAccountPolicy(id: string): DepartmentAccountPolicy {
  const policy = DEPARTMENT_ACCOUNT_POLICIES[id];
  if (!policy) throw new Error(`unknown department account policy: ${id}`);
  return policy;
}
