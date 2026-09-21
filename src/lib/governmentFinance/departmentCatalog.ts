/**
 * Government departments. Laws keep stable portfolio ids while this catalog
 * resolves the institution and Cabinet office that administer them by country.
 */
import { resolveDepartment } from "@/lib/cabinet/rosterEra";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

export type DepartmentCountryId = "US" | "UK" | "JP";

export type DepartmentKind =
  | "spending_department"
  | "finance_ministry"
  | "executive_centre"
  | "coordinating_office"
  | "territorial_office"
  | "security_agency";

export type PortfolioId =
  | "finance"
  | "foreign_affairs"
  | "defense"
  | "justice"
  | "interior_local_government"
  | "economy_industry"
  | "labor_social_protection"
  | "health"
  | "education_research"
  | "transport_infrastructure"
  | "agriculture_rural_affairs"
  | "environment_energy"
  | "housing"
  | "intelligence";

export interface DepartmentDefinition {
  id: string;
  countryId: DepartmentCountryId;
  kind: DepartmentKind;
  canonicalName: string;
  portfolioIds: PortfolioId[];
  controllingPositionIds: string[];
  /** False when a coordinating minister controls a separately named institution. */
  usesControllerDepartmentName?: boolean;
  activeFromYear: number;
  activeToYear?: number;
  requiresEnabledSeatId?: string;
  accountPolicyId?: string;
}

const civil = "civil_operating";
const capital = "civil_capital";

export const DEPARTMENT_DEFINITIONS: readonly DepartmentDefinition[] = [
  // United States
  {
    id: "us_treasury_department",
    countryId: "US",
    kind: "finance_ministry",
    canonicalName: "U.S. Department of the Treasury",
    portfolioIds: ["finance"],
    controllingPositionIds: ["secretary_of_treasury"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "us_state_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of State",
    portfolioIds: ["foreign_affairs"],
    controllingPositionIds: ["secretary_of_state"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "us_defense_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Defense",
    portfolioIds: ["defense"],
    controllingPositionIds: ["secretary_of_defense"],
    activeFromYear: 1775,
    accountPolicyId: "defense",
  },
  {
    id: "us_justice_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Justice",
    portfolioIds: ["justice"],
    controllingPositionIds: ["attorney_general"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "us_interior_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of the Interior",
    portfolioIds: ["interior_local_government"],
    controllingPositionIds: ["secretary_of_interior"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "us_commerce_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Commerce",
    portfolioIds: ["economy_industry"],
    controllingPositionIds: ["secretary_of_commerce"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "us_labor_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Labor",
    portfolioIds: ["labor_social_protection"],
    controllingPositionIds: ["secretary_of_labor"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "us_health_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Health and Human Services",
    portfolioIds: ["health"],
    controllingPositionIds: ["secretary_of_health"],
    activeFromYear: 1953,
    accountPolicyId: civil,
  },
  {
    id: "us_education_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Education",
    portfolioIds: ["education_research"],
    controllingPositionIds: ["secretary_of_education"],
    activeFromYear: 1775,
    requiresEnabledSeatId: "secretary_of_education",
    accountPolicyId: civil,
  },
  {
    id: "us_transportation_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Transportation",
    portfolioIds: ["transport_infrastructure"],
    controllingPositionIds: ["secretary_of_transportation"],
    activeFromYear: 1967,
    accountPolicyId: capital,
  },
  {
    id: "us_agriculture_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Agriculture",
    portfolioIds: ["agriculture_rural_affairs"],
    controllingPositionIds: ["secretary_of_agriculture"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "us_energy_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Energy",
    portfolioIds: ["environment_energy"],
    controllingPositionIds: ["secretary_of_energy"],
    activeFromYear: 1977,
    accountPolicyId: capital,
  },
  {
    id: "us_housing_department",
    countryId: "US",
    kind: "spending_department",
    canonicalName: "U.S. Department of Housing and Urban Development",
    portfolioIds: ["housing"],
    controllingPositionIds: ["secretary_of_hud"],
    activeFromYear: 1965,
    accountPolicyId: civil,
  },
  {
    id: "us_intelligence_agency",
    countryId: "US",
    kind: "security_agency",
    canonicalName: "Central Intelligence Agency",
    portfolioIds: ["intelligence"],
    controllingPositionIds: ["director_of_intelligence"],
    activeFromYear: 1946,
    accountPolicyId: "intelligence",
  },

  // United Kingdom
  {
    id: "uk_treasury",
    countryId: "UK",
    kind: "finance_ministry",
    canonicalName: "HM Treasury",
    portfolioIds: ["finance"],
    controllingPositionIds: ["chancellor"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "uk_foreign_office",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Foreign, Commonwealth and Development Office",
    portfolioIds: ["foreign_affairs"],
    controllingPositionIds: ["foreign_secretary"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "uk_defence_ministry",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Ministry of Defence",
    portfolioIds: ["defense"],
    controllingPositionIds: ["defence_secretary"],
    activeFromYear: 1775,
    accountPolicyId: "defense",
  },
  {
    id: "uk_justice_ministry",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Ministry of Justice",
    portfolioIds: ["justice"],
    controllingPositionIds: ["justice_secretary"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "uk_home_office",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Home Office",
    portfolioIds: ["interior_local_government"],
    controllingPositionIds: ["home_secretary"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "uk_business_department",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Department for Business and Trade",
    portfolioIds: ["economy_industry", "environment_energy"],
    controllingPositionIds: ["business_secretary"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "uk_work_department",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Department for Work and Pensions",
    portfolioIds: ["labor_social_protection"],
    controllingPositionIds: ["work_secretary"],
    activeFromYear: 1775,
    accountPolicyId: "civil_demand_led",
  },
  {
    id: "uk_health_department",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Department of Health and Social Care",
    portfolioIds: ["health"],
    controllingPositionIds: ["health_secretary"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "uk_education_department",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Department for Education",
    portfolioIds: ["education_research"],
    controllingPositionIds: ["education_secretary"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "uk_transport_department",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Department for Transport",
    portfolioIds: ["transport_infrastructure"],
    controllingPositionIds: ["transport_secretary"],
    activeFromYear: 1775,
    accountPolicyId: capital,
  },
  {
    id: "uk_agriculture_department",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Ministry of Agriculture, Fisheries and Food",
    portfolioIds: ["agriculture_rural_affairs"],
    controllingPositionIds: ["agriculture_secretary"],
    activeFromYear: 1775,
    activeToYear: 2001,
    accountPolicyId: civil,
  },
  {
    id: "uk_environment_department",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Department for Environment, Food and Rural Affairs",
    portfolioIds: ["agriculture_rural_affairs", "environment_energy"],
    controllingPositionIds: ["environment_secretary"],
    activeFromYear: 2001,
    accountPolicyId: civil,
  },
  {
    id: "uk_housing_department",
    countryId: "UK",
    kind: "spending_department",
    canonicalName: "Ministry of Housing, Communities and Local Government",
    portfolioIds: ["housing"],
    controllingPositionIds: ["levelling_secretary"],
    activeFromYear: 1775,
    accountPolicyId: capital,
  },
  {
    id: "uk_intelligence_agency",
    countryId: "UK",
    kind: "security_agency",
    canonicalName: "Secret Intelligence Service",
    portfolioIds: ["intelligence"],
    controllingPositionIds: ["director_of_intelligence"],
    activeFromYear: 1909,
    accountPolicyId: "intelligence",
  },

  // Japan
  {
    id: "jp_finance_ministry",
    countryId: "JP",
    kind: "finance_ministry",
    canonicalName: "Ministry of Finance",
    portfolioIds: ["finance"],
    controllingPositionIds: ["finance_minister"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "jp_foreign_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Foreign Affairs",
    portfolioIds: ["foreign_affairs"],
    controllingPositionIds: ["foreign_affairs_minister"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "jp_defense_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Defense",
    portfolioIds: ["defense"],
    controllingPositionIds: ["defense_minister"],
    activeFromYear: 1775,
    accountPolicyId: "defense",
  },
  {
    id: "jp_justice_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Justice",
    portfolioIds: ["justice"],
    controllingPositionIds: ["justice_minister"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "jp_internal_affairs_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Internal Affairs and Communications",
    portfolioIds: ["interior_local_government"],
    controllingPositionIds: ["internal_affairs_minister"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "jp_economy_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Economy, Trade and Industry",
    portfolioIds: ["economy_industry"],
    controllingPositionIds: ["economy_minister"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "jp_health_labor_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Health, Labour and Welfare",
    portfolioIds: ["labor_social_protection", "health"],
    controllingPositionIds: ["health_minister"],
    activeFromYear: 1775,
    accountPolicyId: "civil_demand_led",
  },
  {
    id: "jp_education_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Education, Culture, Sports, Science and Technology",
    portfolioIds: ["education_research"],
    controllingPositionIds: ["education_minister"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "jp_land_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Land, Infrastructure, Transport and Tourism",
    portfolioIds: ["transport_infrastructure", "housing"],
    controllingPositionIds: ["land_minister"],
    activeFromYear: 1775,
    accountPolicyId: capital,
  },
  {
    id: "jp_agriculture_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of Agriculture, Forestry and Fisheries",
    portfolioIds: ["agriculture_rural_affairs"],
    controllingPositionIds: ["economy_minister"],
    usesControllerDepartmentName: false,
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "jp_environment_ministry",
    countryId: "JP",
    kind: "spending_department",
    canonicalName: "Ministry of the Environment",
    portfolioIds: ["environment_energy"],
    controllingPositionIds: ["environment_minister"],
    activeFromYear: 1775,
    accountPolicyId: civil,
  },
  {
    id: "jp_intelligence_agency",
    countryId: "JP",
    kind: "security_agency",
    canonicalName: "Cabinet Intelligence and Research Office",
    portfolioIds: ["intelligence"],
    controllingPositionIds: ["chief_cabinet_secretary"],
    usesControllerDepartmentName: false,
    activeFromYear: 1775,
    accountPolicyId: "intelligence",
  },
] as const;

export function isDepartmentActive(
  definition: DepartmentDefinition,
  year: number | null,
  enabledSeats?: ReadonlySet<string>
): boolean {
  if (definition.requiresEnabledSeatId && !enabledSeats?.has(definition.requiresEnabledSeatId)) {
    return false;
  }
  if (year === null) return true;
  return (
    year >= definition.activeFromYear &&
    (definition.activeToYear === undefined || year < definition.activeToYear)
  );
}

export function resolveDepartmentDefinitionName(
  definition: DepartmentDefinition,
  year: number | null
): string {
  if (definition.usesControllerDepartmentName === false) return definition.canonicalName;
  for (const positionId of definition.controllingPositionIds) {
    const mechanics = getCabinetMechanics(definition.countryId, positionId);
    if (mechanics) return resolveDepartment(mechanics, year);
  }
  return definition.canonicalName;
}

export function getDepartmentDefinitions(
  countryId: DepartmentCountryId,
  year: number | null,
  enabledSeats?: ReadonlySet<string>
): DepartmentDefinition[] {
  return DEPARTMENT_DEFINITIONS.filter(
    (definition) =>
      definition.countryId === countryId && isDepartmentActive(definition, year, enabledSeats)
  );
}

export function resolvePortfolioDepartment(
  countryId: DepartmentCountryId,
  portfolioId: PortfolioId,
  year: number | null,
  enabledSeats?: ReadonlySet<string>
): DepartmentDefinition | undefined {
  const resolved = getDepartmentDefinitions(countryId, year, enabledSeats).find((definition) =>
    definition.portfolioIds.includes(portfolioId)
  );
  if (resolved) return resolved;
  // Before the legislation-driven education split, HEW owns education.
  if (countryId === COUNTRY_CONFIGS.US.id && portfolioId === "education_research") {
    return getDepartmentDefinitions(countryId, year, enabledSeats).find(
      (definition) => definition.id === "us_health_department"
    );
  }
  return undefined;
}
