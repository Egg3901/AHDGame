import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { UNION_NAMES_BY_ERA } from "@/lib/seeds/reference/unionNames";
import { eraForPreset, type EraId } from "@/lib/seeds/presetSelector";

const ERA_FALLBACK_CHAIN: Record<EraId, EraId[]> = {
  "2023": ["2023", "2019"],
  "2019": ["2019"],
  "2007": ["2007", "2019"],
  "1999": ["1999", "2019"],
  "1991": ["1991"],
  "1979": ["1979"],
  "1953": ["1953"],
};

/** Generic fallback when no era-specific historical name exists for a pair. */
export function genericUnionName(countryId: CountryId, sectorType: CorporationType): string {
  const country = COUNTRY_CONFIGS[countryId]?.name ?? countryId;
  const sector = CORPORATION_TYPE_LABELS[sectorType] ?? sectorType;
  return `${country} ${sector} Workers' Union`;
}

/**
 * Resolve the display/seed name for a (countryId, sectorType) union in the
 * active preset's era. Uses era-appropriate historical names where authored,
 * otherwise {@link genericUnionName}.
 */
export function getUnionName(
  countryId: CountryId,
  sectorType: CorporationType,
  preset: string
): string {
  const era = eraForPreset(preset);
  for (const candidateEra of ERA_FALLBACK_CHAIN[era]) {
    const named = UNION_NAMES_BY_ERA[candidateEra]?.[countryId]?.[sectorType];
    if (named) return named;
  }
  return genericUnionName(countryId, sectorType);
}
