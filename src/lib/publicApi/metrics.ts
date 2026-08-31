import type { MetricCategoryId } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { loadNationalMetrics } from "@/lib/country/nationalMetrics";

export const PUBLIC_METRIC_CATEGORIES = [
  "economic",
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "environment",
  "social",
  "governance",
  "population",
  "mediaInformation",
] as const satisfies readonly MetricCategoryId[];

export function isPublicMetricCategory(value: string): value is MetricCategoryId {
  return (PUBLIC_METRIC_CATEGORIES as readonly string[]).includes(value);
}

export async function queryCountryMetrics(
  country: string,
  category: MetricCategoryId | null = null
) {
  const countryId = country.toUpperCase() as CountryId;
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return null;

  const metrics = await loadNationalMetrics(countryId, category);
  if (!metrics) return { found: false, countryId, countryName: config.name };

  return {
    found: true,
    countryId,
    countryName: config.name,
    calculatedAt: metrics.calculatedAt,
    population: metrics.totalPopulation,
    gdpMillions: metrics.gdpMillions,
    gdpPerCapita: metrics.gdpPerCapita,
    currencyCode: metrics.currencyCode,
    governmentApproval: metrics.governmentApproval,
    governmentApprovalBase: metrics.governmentApprovalBase,
    categories: metrics.categories,
    regions: metrics.stateApprovals.map((region) => ({
      id: region.stateId,
      name: region.stateName,
      approval: region.approval,
      baseApproval: region.baseApproval,
    })),
  };
}
