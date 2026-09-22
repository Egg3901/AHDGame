import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { JP_ECONOMY } from "@/lib/countries/jp/economy";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { DE_ECONOMY } from "@/lib/countries/de/economy";
import { CN_ECONOMY } from "@/lib/countries/cn/economy";
import { IE_ECONOMY } from "@/lib/countries/ie/economy";
import { NG_ECONOMY } from "@/lib/countries/ng/economy";
import { BR_ECONOMY } from "@/lib/countries/br/economy";

/**
 * Per-country default strategic sectors (spec §6.3). Designating a sector type
 * strategic arms the strategic nationalization trigger for corps operating in it.
 * Flavored to each economy; tunable. Countries absent here seed no defaults.
 */
export const DEFAULT_STRATEGIC_SECTORS: Partial<Record<CountryId, CorporationType[]>> = {
  US: US_ECONOMY.strategicSectors,
  UK: UK_ECONOMY.strategicSectors,
  DE: DE_ECONOMY.strategicSectors,
  JP: JP_ECONOMY.strategicSectors,
  CN: CN_ECONOMY.strategicSectors,
  IE: IE_ECONOMY.strategicSectors,
  BR: BR_ECONOMY.strategicSectors,
  NG: NG_ECONOMY.strategicSectors,
};
