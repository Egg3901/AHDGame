import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * Per-country default strategic sectors (spec §6.3). Designating a sector type
 * strategic arms the strategic nationalization trigger for corps operating in it.
 * Flavored to each economy; tunable. Countries absent here seed no defaults.
 */
export const DEFAULT_STRATEGIC_SECTORS: Partial<Record<CountryId, CorporationType[]>> = {
  US: ["defense", "technology"],
  UK: ["financial", "energy"],
  DE: ["automobiles", "energy"],
  JP: ["technology", "automobiles"],
  CN: ["telecommunications", "technology", "energy"],
  IE: ["technology", "financial"],
  BR: ["agriculture", "extraction"],
  NG: ["extraction", "energy"],
};
