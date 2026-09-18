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
import { CN_CABINET_GROUPS } from "@/lib/countries/cn/institutionsFacts";
import { IE_CABINET_GROUPS } from "@/lib/countries/ie/institutionsFacts";

export const GROUPS: Record<string, Record<string, CabinetGroup>> = {
  US: US_CABINET_GROUPS,
  UK: UK_CABINET_GROUPS,
  JP: JP_INSTITUTIONS.cabinet.groups,
  IE: IE_CABINET_GROUPS,
  DE: DE_CABINET_GROUPS,
  CN: CN_CABINET_GROUPS,
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
