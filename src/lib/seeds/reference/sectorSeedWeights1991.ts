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

type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_1991: Record<CountryId, SectorWeightMap> = {
  US: {
    manufacturing: 14,
    financial: 9,
    real_estate: 11,
    retail: 9,
    healthcare: 7,
    construction: 7,
    automobiles: 6,
    defense: 7,
    chemical_industries: 6,
    energy: 5,
    telecommunications: 3,
    logistics: 4,
    media: 3,
    technology: 3, // 1991: hardware + early networking, no platform tech
    agriculture: 3,
    extraction: 2,
    entertainment: 1,
  },
  UK: {
    manufacturing: 16,
    financial: 11,
    retail: 9,
    construction: 8,
    real_estate: 10,
    healthcare: 6,
    chemical_industries: 6,
    energy: 5,
    defense: 5,
    automobiles: 4,
    extraction: 4, // North Sea oil/gas
    logistics: 3,
    telecommunications: 3,
    media: 4,
    entertainment: 2,
    technology: 2,
    agriculture: 2,
  },
  // Latent - mirrors UK; dedicated SCO weights are not authored.
  SCO: {
    manufacturing: 16,
    financial: 11,
    retail: 9,
    construction: 8,
    real_estate: 10,
    healthcare: 6,
    chemical_industries: 6,
    energy: 5,
    defense: 5,
    automobiles: 4,
    extraction: 4, // North Sea oil/gas
    logistics: 3,
    telecommunications: 3,
    media: 4,
    entertainment: 2,
    technology: 2,
    agriculture: 2,
  },
  // Latent - mirrors UK; dedicated WAL weights are not authored.
  WAL: {
    manufacturing: 16,
    financial: 11,
    retail: 9,
    construction: 8,
    real_estate: 10,
    healthcare: 6,
    chemical_industries: 6,
    energy: 5,
    defense: 5,
    automobiles: 4,
    extraction: 4,
    logistics: 3,
    telecommunications: 3,
    media: 4,
    entertainment: 2,
    technology: 2,
    agriculture: 2,
  },
  DE: {
    manufacturing: 22,
    automobiles: 11,
    chemical_industries: 11,
    construction: 8,
    real_estate: 8,
    financial: 7,
    retail: 6,
    healthcare: 5,
    energy: 5,
    logistics: 4,
    defense: 3,
    media: 2,
    technology: 3, // 1991 DE tech = Siemens electronics, not software
    telecommunications: 2,
    entertainment: 1,
    agriculture: 1,
    extraction: 1,
  },
  JP: {
    manufacturing: 18,
    automobiles: 12,
    real_estate: 9, // bubble-era weighting; collapsing
    financial: 12,
    construction: 9, // public works heavy
    technology: 8, // 1991 JP tech = electronics (Sony/NEC/Toshiba), not platforms
    retail: 7,
    chemical_industries: 5,
    healthcare: 5,
    telecommunications: 3,
    logistics: 4,
    entertainment: 2,
    media: 2,
    energy: 2,
    defense: 1,
    agriculture: 2,
    extraction: 1,
  },
  CN: {
    manufacturing: 28,
    agriculture: 24,
    construction: 7,
    extraction: 8,
    energy: 6,
    retail: 5,
    chemical_industries: 5,
    logistics: 4,
    financial: 3,
    real_estate: 3,
    healthcare: 3,
    defense: 2,
    automobiles: 1, // pre-WTO, before joint-venture explosion
    telecommunications: 1,
    technology: 1,
    media: 1,
    entertainment: 1,
  },
  IE: {
    agriculture: 9,
    manufacturing: 22,
    retail: 8,
    construction: 8,
    chemical_industries: 8, // pre-pharma-cluster but agri-chemical present
    financial: 7,
    real_estate: 7,
    healthcare: 6,
    energy: 4,
    logistics: 4,
    automobiles: 2,
    media: 2,
    technology: 4, // FDI just beginning (Intel arrived 1989)
    telecommunications: 2,
    extraction: 4,
    entertainment: 2,
    defense: 1,
  },
  BR: {
    agriculture: 14,
    manufacturing: 22,
    real_estate: 8,
    extraction: 9,
    energy: 8,
    financial: 6, // hyperinflation distorts banking weight
    retail: 7,
    construction: 8,
    chemical_industries: 6,
    automobiles: 4,
    logistics: 3,
    healthcare: 3,
    telecommunications: 1,
    technology: 1,
    media: 2,
    entertainment: 1,
    defense: 1,
  },
  NG: {
    extraction: 30, // oil-dominant
    agriculture: 27,
    manufacturing: 8,
    energy: 6,
    construction: 6,
    real_estate: 5,
    retail: 5,
    telecommunications: 1,
    financial: 3,
    healthcare: 2,
    logistics: 2,
    chemical_industries: 2,
    automobiles: 1,
    technology: 1,
    media: 1,
    entertainment: 1,
    defense: 1,
  },
  // Hungary — planned socialist economy.
  HU: {
    manufacturing: 24,
    agriculture: 16,
    chemical_industries: 10,
    energy: 9,
    construction: 8,
    automobiles: 6,
    retail: 6,
    logistics: 5,
    healthcare: 4,
    extraction: 3,
    real_estate: 3,
    defense: 2,
    financial: 1,
    technology: 1,
    telecommunications: 1,
    media: 1,
    entertainment: 1,
  },
  // Eastern Bloc planned economies (normalized at read).
  PL: {
    manufacturing: 22,
    agriculture: 13,
    extraction: 11,
    energy: 8,
    chemical_industries: 8,
    construction: 7,
    retail: 6,
    healthcare: 5,
  },
  RO: {
    manufacturing: 20,
    agriculture: 16,
    energy: 10,
    extraction: 8,
    chemical_industries: 8,
    construction: 7,
    retail: 6,
    healthcare: 4,
  },
  YU: {
    manufacturing: 16,
    agriculture: 12,
    retail: 10,
    construction: 9,
    logistics: 7,
    entertainment: 6,
    real_estate: 6,
    healthcare: 6,
    financial: 4,
  },
  BG: {
    agriculture: 20,
    manufacturing: 18,
    energy: 8,
    chemical_industries: 7,
    construction: 7,
    retail: 6,
    healthcare: 5,
  },
  // Ukraine. Post-Soviet shape even in the eras where it is not seeded: the
  // Donbas/Dnieper metallurgical belt and the black-earth grain surplus are the
  // two things that survive every regime change.
  UKR: {
    manufacturing: 22,
    agriculture: 16,
    extraction: 10,
    energy: 9,
    chemical_industries: 8,
    construction: 7,
    retail: 6,
    healthcare: 5,
  },
  BLR: {
    manufacturing: 24,
    agriculture: 16,
    chemical_industries: 10,
    energy: 8,
    construction: 7,
    automobiles: 6,
    retail: 5,
  },
  CS: {
    manufacturing: 28,
    automobiles: 10,
    chemical_industries: 9,
    energy: 8,
    construction: 7,
    retail: 6,
    healthcare: 5,
  },
  BAL: {
    manufacturing: 18,
    agriculture: 16,
    logistics: 8,
    energy: 7,
    construction: 7,
    retail: 6,
    healthcare: 5,
  },
  // USSR — command economy: heavy industry, energy/extraction, defense, agriculture.
  RU: {
    manufacturing: 20,
    energy: 12,
    extraction: 10,
    defense: 10,
    agriculture: 12,
    chemical_industries: 8,
    construction: 7,
    automobiles: 5,
    logistics: 4,
    healthcare: 4,
    retail: 3,
    technology: 2,
    real_estate: 1,
  },
  FR: {
    manufacturing: 16,
    real_estate: 11,
    financial: 9,
    retail: 8,
    automobiles: 8,
    agriculture: 8,
    healthcare: 7,
    energy: 7,
    construction: 6,
    chemical_industries: 5,
    defense: 5,
    logistics: 4,
    entertainment: 3,
    technology: 2,
    media: 1,
  },
  IT: {
    manufacturing: 18,
    real_estate: 11,
    retail: 9,
    automobiles: 8,
    agriculture: 8,
    entertainment: 7,
    financial: 6,
    construction: 6,
    energy: 6,
    healthcare: 6,
    chemical_industries: 5,
    logistics: 4,
    defense: 3,
    technology: 2,
    media: 1,
  },
  ES: {
    manufacturing: 14,
    real_estate: 12,
    retail: 9,
    agriculture: 9,
    entertainment: 8,
    automobiles: 7,
    construction: 7,
    financial: 6,
    healthcare: 6,
    energy: 6,
    chemical_industries: 4,
    logistics: 4,
    defense: 2,
    technology: 1,
    media: 1,
  },
  SE: {
    manufacturing: 16,
    real_estate: 11,
    healthcare: 9,
    retail: 8,
    technology: 7,
    automobiles: 7,
    financial: 6,
    energy: 6,
    extraction: 6,
    construction: 5,
    logistics: 4,
    agriculture: 3,
    defense: 3,
    entertainment: 2,
    media: 1,
  },
  GR: {
    logistics: 13, // merchant marine
    agriculture: 12,
    retail: 10,
    manufacturing: 10,
    real_estate: 10,
    construction: 8,
    entertainment: 8, // tourism boom
    financial: 6,
    energy: 6,
    healthcare: 5,
    media: 4,
    extraction: 4,
    defense: 4,
  },
  AT: {
    manufacturing: 20, // post-VOEST-crisis industry still large
    retail: 10,
    real_estate: 10,
    construction: 9,
    financial: 8,
    entertainment: 8, // tourism
    energy: 7,
    healthcare: 6,
    logistics: 6,
    agriculture: 5,
    chemical_industries: 4,
    extraction: 3,
    technology: 2,
    media: 2,
  },
  FI: {
    manufacturing: 22, // forest industries + metal/engineering
    financial: 9, // pre-crash casino-economy banking
    real_estate: 10,
    retail: 9,
    construction: 8,
    energy: 7,
    extraction: 7, // forestry
    logistics: 6,
    healthcare: 6,
    agriculture: 6,
    chemical_industries: 4,
    technology: 3, // Nokia pivoting to telecoms
    media: 2,
    defense: 1,
  },
  TR: {
    manufacturing: 16,
    agriculture: 14,
    real_estate: 11,
    retail: 9,
    construction: 8,
    automobiles: 6,
    financial: 5,
    healthcare: 5,
    energy: 5,
    logistics: 5,
    chemical_industries: 4,
    defense: 4,
    entertainment: 4,
    technology: 2,
    media: 2,
  },
  DD: {
    manufacturing: 24,
    chemical_industries: 10,
    energy: 9,
    automobiles: 7,
    agriculture: 9,
    construction: 7,
    extraction: 6,
    defense: 5,
    logistics: 5,
    healthcare: 4,
    retail: 3,
    real_estate: 2,
    technology: 2,
    entertainment: 1,
  },
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
