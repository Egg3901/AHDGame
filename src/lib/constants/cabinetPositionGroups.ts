/**
 * Category groups for the cabinet-office position rail. Kept as a standalone
 * positionId → group map (rather than a field on the per-country position
 * arrays) so the arrays keep inferring their literal `CabinetPositionId` types
 * and to avoid an import cycle with cabinetMechanics. Mirrors the grouping in
 * the "Cabinet Office" design prototype.
 */
export type CabinetGroup =
  "Centre" | "Economy" | "Security & Foreign" | "Society" | "Domestic" | "Nations";
import { JP_INSTITUTIONS } from "@/lib/countries/jp/institutions";
import { US_CABINET_GROUPS } from "@/lib/countries/us/institutionsFacts";
import { UK_CABINET_GROUPS } from "@/lib/countries/uk/institutionsFacts";
import { DE_CABINET_GROUPS } from "@/lib/countries/de/institutionsFacts";

export const GROUPS: Record<string, Record<string, CabinetGroup>> = {
  US: US_CABINET_GROUPS,
  UK: UK_CABINET_GROUPS,
  JP: JP_INSTITUTIONS.cabinet.groups,
  IE: {
    taoiseach: "Centre",
    tanaiste: "Centre",
    minister_for_finance: "Economy",
    minister_for_public_expenditure: "Economy",
    minister_for_enterprise: "Economy",
    minister_for_social_protection: "Economy",
    minister_for_agriculture: "Economy",
    minister_for_foreign_affairs: "Security & Foreign",
    minister_for_justice: "Security & Foreign",
    minister_for_defence: "Security & Foreign",
    minister_for_health: "Society",
    minister_for_education: "Society",
    minister_for_further_higher_education: "Society",
    minister_for_housing: "Society",
    minister_for_children: "Society",
    minister_for_tourism_culture: "Society",
    minister_for_environment_climate: "Domestic",
    minister_for_transport: "Domestic",
    minister_for_rural_community: "Domestic",
  },
  DE: DE_CABINET_GROUPS,
  CN: {
    premier: "Centre",
    vice_premier: "Centre",
    state_councillor: "Centre",
    minister_of_finance: "Economy",
    pboc_governor: "Economy",
    minister_of_commerce: "Economy",
    minister_of_human_resources_social_security: "Economy",
    minister_of_agriculture_rural_affairs: "Economy",
    minister_of_foreign_affairs: "Security & Foreign",
    minister_of_defense: "Security & Foreign",
    minister_of_public_security: "Security & Foreign",
    minister_of_education: "Society",
    minister_of_health: "Society",
    minister_of_housing_urban_rural: "Society",
    minister_of_ecology_environment: "Domestic",
    minister_of_transport: "Domestic",
  },
  RU: {
    director_of_intelligence: "Security & Foreign",
    premier: "Centre",
    first_deputy_premier: "Centre",
    chairman_of_gosplan: "Centre",
    minister_of_finance: "Economy",
    gosbank_liaison: "Economy",
    minister_of_foreign_trade: "Economy",
    minister_of_internal_trade: "Economy",
    minister_of_agriculture: "Economy",
    minister_of_machine_building: "Economy",
    minister_of_foreign_affairs: "Security & Foreign",
    minister_of_defence: "Security & Foreign",
    minister_of_internal_affairs: "Security & Foreign",
    minister_of_culture: "Society",
    minister_of_health: "Society",
    minister_of_higher_education: "Society",
    minister_of_railways: "Domestic",
  },
  NG: {
    director_of_intelligence: "Security & Foreign",
    secretary_to_government: "Centre",
    minister_of_finance: "Economy",
    minister_of_petroleum_resources: "Economy",
    minister_of_power: "Economy",
    minister_of_trade_industry: "Economy",
    minister_of_labour: "Economy",
    minister_of_agriculture: "Economy",
    minister_of_defence: "Security & Foreign",
    minister_of_foreign_affairs: "Security & Foreign",
    minister_of_interior: "Security & Foreign",
    minister_of_justice: "Security & Foreign",
    minister_of_health: "Society",
    minister_of_education: "Society",
    minister_of_works_housing: "Society",
    minister_of_information: "Society",
    minister_of_environment: "Domestic",
  },
};

export function getCabinetPositionGroup(countryId: string, positionId: string): CabinetGroup {
  return GROUPS[countryId]?.[positionId] ?? "Centre";
}
