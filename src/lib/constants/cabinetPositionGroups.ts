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
import { RU_CABINET_GROUPS } from "@/lib/countries/ru/institutionsFacts";
import { NG_CABINET_GROUPS } from "@/lib/countries/ng/institutionsFacts";

export const GROUPS: Record<string, Record<string, CabinetGroup>> = {
  US: US_CABINET_GROUPS,
  UK: UK_CABINET_GROUPS,
  /*
   * ⚠️ `?? {}` IS NOT A DEFAULT, IT IS A TYPE BRIDGE. `cabinet.groups` became
   * optional on the contract because East Germany has no row here at all, and
   * Japan's folder reaches it through the composed institutions object. Japan
   * HAS groups; the fallback is unreachable for it. East Germany simply has no
   * key in this map, so the reader's own `?? "Centre"` still does the work.
   */
  JP: JP_INSTITUTIONS.cabinet.groups ?? {},
  IE: IE_CABINET_GROUPS,
  DE: DE_CABINET_GROUPS,
  CN: CN_CABINET_GROUPS,
  RU: RU_CABINET_GROUPS,
  NG: NG_CABINET_GROUPS,
};

export function getCabinetPositionGroup(countryId: string, positionId: string): CabinetGroup {
  return GROUPS[countryId]?.[positionId] ?? "Centre";
}
