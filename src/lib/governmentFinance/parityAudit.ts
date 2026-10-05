import type { LegislationType } from "@/lib/db/types/legislation";
import type { DepartmentCountryId, DepartmentDefinition, PortfolioId } from "./departmentCatalog";

export const INITIAL_PARITY_COUNTRIES = ["US", "UK", "JP"] as const;
export const REQUIRED_PARITY_PORTFOLIOS: readonly PortfolioId[] = [
  "finance",
  "foreign_affairs",
  "defense",
  "justice",
  "interior_local_government",
  "economy_industry",
  "labor_social_protection",
  "health",
  "education_research",
  "transport_infrastructure",
  "agriculture_rural_affairs",
  "environment_energy",
  "housing",
  "intelligence",
];

export interface CountryParityInventory {
  countryId: DepartmentCountryId;
  lawCount: number;
  optionCount: number;
  programOptionCount: number;
  departmentCount: number;
  authoredPoliticalBaselineAvailable: boolean;
  byPortfolio: Record<string, number>;
  byLawKind: Record<string, number>;
  byDefaultJurisdiction: Record<string, number>;
  missingPortfolioInstitutions: string[];
  missingAdministration: string[];
  programOptionsWithoutOutcome: string[];
}

export interface LegislativeParityAudit {
  countries: CountryParityInventory[];
  catalogErrors: string[];
  unresolvedDecisions: string[];
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function auditLegislativeParity(input: {
  legislationTypes: readonly LegislationType[];
  departments: readonly DepartmentDefinition[];
  politicalMetricCountryIds: ReadonlySet<string>;
}): LegislativeParityAudit {
  const catalogErrors: string[] = [];
  const countries = INITIAL_PARITY_COUNTRIES.map((countryId): CountryParityInventory => {
    const scope = countryId.toLowerCase() as "us" | "uk" | "jp";
    const laws = input.legislationTypes.filter((type) => type.countryScope === scope);
    const departments = input.departments.filter(
      (department) => department.countryId === countryId
    );
    const byPortfolio: Record<string, number> = {};
    const byLawKind: Record<string, number> = {};
    const byDefaultJurisdiction: Record<string, number> = {};
    const missingAdministration: string[] = [];
    const programOptionsWithoutOutcome: string[] = [];
    let optionCount = 0;
    let programOptionCount = 0;

    for (const law of laws) {
      const administration = law.administration;
      if (!administration) {
        missingAdministration.push(law._id);
        continue;
      }
      increment(byPortfolio, administration.primaryPortfolioId);
      increment(byLawKind, administration.lawKind);
      increment(byDefaultJurisdiction, administration.defaultJurisdictionMode);
      if (
        !administration.allowedJurisdictionModes.includes(administration.defaultJurisdictionMode)
      ) {
        catalogErrors.push(`${law._id}: default jurisdiction is not allowed`);
      }
      for (const option of law.policyOptions ?? []) {
        optionCount += 1;
        if (!option.implementation) continue;
        programOptionCount += 1;
        if (!option.implementation.outcome) {
          programOptionsWithoutOutcome.push(`${law._id}:${option.id}`);
        }
      }
    }

    const institutionPortfolios = new Set(
      departments.flatMap((department) => department.portfolioIds)
    );
    return {
      countryId,
      lawCount: laws.length,
      optionCount,
      programOptionCount,
      departmentCount: departments.length,
      authoredPoliticalBaselineAvailable: input.politicalMetricCountryIds.has(countryId),
      byPortfolio,
      byLawKind,
      byDefaultJurisdiction,
      missingPortfolioInstitutions: REQUIRED_PARITY_PORTFOLIOS.filter(
        (portfolio) => !institutionPortfolios.has(portfolio)
      ),
      missingAdministration,
      programOptionsWithoutOutcome,
    };
  });

  const unresolvedDecisions = countries.flatMap((country) => [
    ...(!country.authoredPoliticalBaselineAvailable
      ? [`${country.countryId}: authored political-metric baseline is not yet available`]
      : []),
    ...country.programOptionsWithoutOutcome.map(
      (option) => `${country.countryId}: ${option} has delivery metadata but no authored outcome`
    ),
  ]);
  return { countries, catalogErrors, unresolvedDecisions };
}
