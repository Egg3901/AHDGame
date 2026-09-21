import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { resolveDepartment } from "@/lib/cabinet/rosterEra";
import type { DepartmentAccount } from "@/lib/db/types/budget";
import { DEPARTMENT_DEFINITIONS, type DepartmentDefinition } from "./departmentCatalog";
import { resolveCapacityType } from "./lawAdministrationCatalog";

export const US_HEALTH_DEPARTMENT_ID = "us_health_department";
export const US_PUBLIC_HEALTH_PROGRAM_ID = "us_public_health_workforce";
export const PUBLIC_HEALTH_CAPACITY_TYPE = "public_health_operations";

export function resolveUsHealthDepartmentName(year: number | null): string {
  const mechanics = getCabinetMechanics("US", "secretary_of_health");
  if (!mechanics) throw new Error("US health department mechanics are missing");
  return resolveDepartment(mechanics, year);
}

export function createEmptyUsHealthDepartmentAccount(): DepartmentAccount {
  const definition = DEPARTMENT_DEFINITIONS.find(
    (candidate) => candidate.id === US_HEALTH_DEPARTMENT_ID
  );
  if (!definition) throw new Error("US health department definition is missing");
  const base = createEmptyDepartmentAccount(definition);
  return {
    ...base,
    capacityPools: {
      ...base.capacityPools,
      [PUBLIC_HEALTH_CAPACITY_TYPE]: {
        capacityType: PUBLIC_HEALTH_CAPACITY_TYPE,
        availableThroughput: 80,
        maintenanceDemand: 0,
        sourceBreakdown: {
          workforce: 40,
          facilities: 20,
          systems: 15,
          efficiency: 5,
        },
      },
    },
  };
}

export function createEmptyDepartmentAccount(definition: DepartmentDefinition): DepartmentAccount {
  if (!definition.accountPolicyId) {
    throw new Error(`department does not own an appropriation account: ${definition.id}`);
  }
  const capacityPools: DepartmentAccount["capacityPools"] = {};
  for (const portfolioId of definition.portfolioIds) {
    const capacityType = resolveCapacityType(portfolioId, "service_program");
    if (!capacityType || capacityPools[capacityType]) continue;
    capacityPools[capacityType] = {
      capacityType,
      availableThroughput: 100,
      maintenanceDemand: 0,
      sourceBreakdown: { workforce: 40, facilities: 25, systems: 20, efficiency: 15 },
    };
  }
  return {
    departmentId: definition.id,
    portfolioId: definition.portfolioIds[0]!,
    portfolioIds: [...definition.portfolioIds],
    accountPolicyId: definition.accountPolicyId,
    balance: 0,
    encumbered: 0,
    arrears: 0,
    accruedThroughTurn: 0,
    annualAuthority: 0,
    operatingAuthority: 0,
    capitalAuthority: 0,
    transferAuthority: 0,
    capacityPools,
    programs: {},
  };
}
