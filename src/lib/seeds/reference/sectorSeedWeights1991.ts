/**
 * 1991-era national sector weights, per country.
 *
 * Numbers are rough percentage-of-GDP allocations across the 17 game sectors.
 * Sources are mixed and intended to capture the 1991 economic structure,
 * not modern composition:
 *   US: BEA Industry Accounts 1990-1992 (manufacturing 16%, finance/insurance/real
 *       estate 18%, retail/wholesale 12%, government services 14%, FIRE
 *       weighting lower than current).
 *   UK: ONS 1991 GVA composition (manufacturing 19%, finance 8%, retail 9%,
 *       construction 8%, defence-heavy industrial base).
 *   DE: Bundesbank 1991 (manufacturing 25%, automobiles & chemical 18%,
 *       reunification reconstruction lifted construction; tech was electronics-
 *       and engineering-based, not platform software).
 *   JP: 1990 prefectural GDP (auto 12%, manufacturing 18%, real estate 9% but
 *       cratering, financial 12% in bubble aftermath, construction 9%).
 *   CN: NBS 1991 (manufacturing 30%, agriculture 26%, construction 6%, extraction
 *       8%, tertiary sector ~30%; SOE-dominated economy).
 *   BR: IBGE 1991 (agriculture 14%, manufacturing 27%, extraction 9%, energy 8%;
 *       early-1990s deindustrialization not yet underway).
 *   IE: CSO 1991 (agriculture 9% — still high pre-Celtic-Tiger, manufacturing 24%,
 *       financial 7%, technology near-zero pre-FDI boom).
 *   NG: 1990 estimates (oil-heavy extraction 30%, agriculture 27%, manufacturing 8%).
 *
 * These weights are intentionally less tech/finance-heavy than the current-era
 * defaults in `sectorSeedWeights.ts`. `getStateSectorWeights1991` selects this
 * bundle when the active preset is `1991-default`.
 */

import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { JP_ECONOMY } from "@/lib/countries/jp/economy";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { DE_ECONOMY } from "@/lib/countries/de/economy";
import { CN_ECONOMY } from "@/lib/countries/cn/economy";
import { IE_ECONOMY } from "@/lib/countries/ie/economy";
import { RU_ECONOMY } from "@/lib/countries/ru/economy";
import { DD_ECONOMY } from "@/lib/countries/dd/economy";
import { NG_ECONOMY } from "@/lib/countries/ng/economy";
import { BR_ECONOMY } from "@/lib/countries/br/economy";
import { FR_ECONOMY } from "@/lib/countries/fr/economy";
import { IT_ECONOMY } from "@/lib/countries/it/economy";
import { ES_ECONOMY } from "@/lib/countries/es/economy";
import { SE_ECONOMY } from "@/lib/countries/se/economy";
import { TR_ECONOMY } from "@/lib/countries/tr/economy";
import { GR_ECONOMY } from "@/lib/countries/gr/economy";
import { AT_ECONOMY } from "@/lib/countries/at/economy";
import { FI_ECONOMY } from "@/lib/countries/fi/economy";
import { PL_ECONOMY } from "@/lib/countries/pl/economy";
import { HU_ECONOMY } from "@/lib/countries/hu/economy";
import { RO_ECONOMY } from "@/lib/countries/ro/economy";
import { YU_ECONOMY } from "@/lib/countries/yu/economy";
import { BG_ECONOMY } from "@/lib/countries/bg/economy";
import { CS_ECONOMY } from "@/lib/countries/cs/economy";
import { SCO_ECONOMY } from "@/lib/countries/sco/economy";
import { WAL_ECONOMY } from "@/lib/countries/wal/economy";
import { BLR_ECONOMY } from "@/lib/countries/blr/economy";
import { UKR_ECONOMY } from "@/lib/countries/ukr/economy";
import { BAL_ECONOMY } from "@/lib/countries/bal/economy";

type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_1991: Record<CountryId, SectorWeightMap> = {
  US: US_ECONOMY.sectorWeights.byEra["1991"],
  UK: UK_ECONOMY.sectorWeights.byEra["1991"],
  // Latent - mirrors UK; dedicated SCO weights are not authored.
  SCO: SCO_ECONOMY.sectorWeights.byEra["1991"],
  // Latent - mirrors UK; dedicated WAL weights are not authored.
  WAL: WAL_ECONOMY.sectorWeights.byEra["1991"],
  DE: DE_ECONOMY.sectorWeights.byEra["1991"],
  JP: JP_ECONOMY.sectorWeights.byEra["1991"],
  CN: CN_ECONOMY.sectorWeights.byEra["1991"],
  IE: IE_ECONOMY.sectorWeights.byEra["1991"],
  BR: BR_ECONOMY.sectorWeights.byEra["1991"],
  NG: NG_ECONOMY.sectorWeights.byEra["1991"],
  // Hungary — planned socialist economy.
  HU: HU_ECONOMY.sectorWeights.byEra["1991"],
  // Eastern Bloc planned economies (normalized at read).
  PL: PL_ECONOMY.sectorWeights.byEra["1991"],
  RO: RO_ECONOMY.sectorWeights.byEra["1991"],
  YU: YU_ECONOMY.sectorWeights.byEra["1991"],
  BG: BG_ECONOMY.sectorWeights.byEra["1991"],
  // Ukraine. Post-Soviet shape even in the eras where it is not seeded: the
  // Donbas/Dnieper metallurgical belt and the black-earth grain surplus are the
  // two things that survive every regime change.
  UKR: UKR_ECONOMY.sectorWeights.byEra["1991"],
  BLR: BLR_ECONOMY.sectorWeights.byEra["1991"],
  CS: CS_ECONOMY.sectorWeights.byEra["1991"],
  BAL: BAL_ECONOMY.sectorWeights.byEra["1991"],
  // USSR — command economy: heavy industry, energy/extraction, defense, agriculture.
  RU: RU_ECONOMY.sectorWeights.byEra["1991"],
  FR: FR_ECONOMY.sectorWeights.byEra["1991"],
  IT: IT_ECONOMY.sectorWeights.byEra["1991"],
  ES: ES_ECONOMY.sectorWeights.byEra["1991"],
  SE: SE_ECONOMY.sectorWeights.byEra["1991"],
  GR: GR_ECONOMY.sectorWeights.byEra["1991"],
  AT: AT_ECONOMY.sectorWeights.byEra["1991"],
  FI: FI_ECONOMY.sectorWeights.byEra["1991"],
  TR: TR_ECONOMY.sectorWeights.byEra["1991"],
  DD: DD_ECONOMY.sectorWeights.byEra["1991"],
};

/**
 * Returns the 1991 country-level sector weight map.
 * Used by `getStateSectorWeights` when the active preset is `1991-default`.
 */
export function getCountrySectorWeights1991(countryId: CountryId): Record<CorporationType, number> {
  const raw = COUNTRY_SECTOR_WEIGHTS_1991[countryId] ?? {};
  const entries = CORPORATION_TYPES.map((t) => [t, raw[t] ?? 0] as const);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) {
    const even = 1 / CORPORATION_TYPES.length;
    return Object.fromEntries(CORPORATION_TYPES.map((t) => [t, even])) as Record<
      CorporationType,
      number
    >;
  }
  return Object.fromEntries(entries.map(([t, v]) => [t, v / total])) as Record<
    CorporationType,
    number
  >;
}
