/**
 * Maps state/region IDs to their parent country, and maps ISO numeric
 * country codes to our internal CountryId.
 *
 * This is the single source of truth for commodity map geography.
 */

import { compactRegionCode, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { frRegions } from "@/lib/seeds/fr/frRegions";
import { itRegions } from "@/lib/seeds/it/itRegions";
import { esRegions } from "@/lib/seeds/es/esRegions";
import { seRegions } from "@/lib/seeds/se/seRegions";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { grRegions } from "@/lib/seeds/gr/grRegions";
import { atRegions } from "@/lib/seeds/at/atRegions";
import { fiRegions } from "@/lib/seeds/fi/fiRegions";
import { huRegions } from "@/lib/seeds/hu/huRegions";
import { plRegions } from "@/lib/seeds/pl/plRegions";
import { roRegions } from "@/lib/seeds/ro/roRegions";
import { yuRegions } from "@/lib/seeds/yu/yuRegions";
import { bgRegions } from "@/lib/seeds/bg/bgRegions";
import { csRegions } from "@/lib/seeds/cs/csRegions";
import { blrRegions } from "@/lib/seeds/blr/blrRegions";
import { balRegions } from "@/lib/seeds/bal/balRegions";

// ISO-numeric ⇄ CountryId now live in the neutral countryIso module so non-commodity
// surfaces (e.g. the IntOrg world map) can reuse them without depending on this file.
export { ISO_NUMERIC_TO_COUNTRY, COUNTRY_TO_ISO_NUMERIC } from "@/lib/constants/countryIso";

/**
 * Display names for state/region IDs, scoped by country.
 *
 * Keyed by countryId because some IDs collide across countries — e.g. DE's HB
 * (Bremen) and CN's HB (Huabei). Lookups must therefore disambiguate by
 * country; see `getStateDisplayName(countryId, stateId)`.
 */
export const STATE_DISPLAY_NAMES: Partial<Record<CountryId, Record<string, string>>> = {
  UK: {
    LON: "London",
    SEE: "South East",
    SWE: "South West",
    EAE: "East of England",
    EMI: "East Midlands",
    WMI: "West Midlands",
    YHU: "Yorkshire",
    NWE: "North West",
    NEE: "North East",
    SCO: "Scotland",
    WAL: "Wales",
    NIR: "N. Ireland",
  },
  JP: {
    HOK: "Hokkaido",
    TOH: "Tohoku",
    KAN: "Kanto",
    CHU: "Chubu",
    KNS: "Kansai",
    CGK: "Chugoku",
    SHI: "Shikoku",
    KYU: "Kyushu & Okinawa",
  },
  DE: {
    NW: "North Rhine-Westphalia",
    BY: "Bavaria",
    BW: "Baden-Württemberg",
    NI: "Lower Saxony",
    HE: "Hesse",
    SN: "Saxony",
    RP: "Rhineland-Palatinate",
    ST: "Saxony-Anhalt",
    SH: "Schleswig-Holstein",
    TH: "Thuringia",
    BB: "Brandenburg",
    MV: "Mecklenburg-Vorpommern",
    SL: "Saarland",
    BE: "Berlin",
    HH: "Hamburg",
    BRE: "Bremen",
  },
  IE: {
    DUB: "Dublin",
    KIL: "Kildare",
    MID: "Midlands",
    LIM: "Limerick",
    COR: "Cork",
    WEX: "Wexford",
    GAL: "Galway",
    DON: "Donegal",
  },
  BR: {
    NORTE: "Norte",
    NORDESTE: "Nordeste",
    CENTRO_OESTE: "Centro-Oeste",
    SUDESTE: "Sudeste",
    SUL: "Sul",
  },
  CN: {
    DB: "Dongbei",
    HB: "Huabei",
    HD: "Huadong",
    HZ: "Huazhong",
    HN: "Huanan",
    XN: "Xinan",
    XB: "Xibei",
  },
  // The prefixed-region countries derive their tables from the seed rosters
  // below — no hand-maintained copies to drift.
  ...Object.fromEntries(
    (
      [
        frRegions,
        itRegions,
        esRegions,
        seRegions,
        trRegions,
        grRegions,
        atRegions,
        fiRegions,
        huRegions,
        plRegions,
        roRegions,
        yuRegions,
        bgRegions,
        csRegions,
        blrRegions,
        balRegions,
      ] as State[][]
    ).map((regions) => [
      regions[0].countryId,
      Object.fromEntries(regions.map((r) => [r._id, r.name])),
    ])
  ),
};

/** Countries that have subnational SVG maps available */
export const COUNTRIES_WITH_REGION_MAPS: Set<CountryId> = new Set(["US", "UK", "JP", "DE"]);

/**
 * Group an array of state IDs by their parent country using the provided mapping.
 */
export function groupStatesByCountry(
  stateIds: string[],
  stateCountryMap: Map<string, CountryId> | Record<string, string>
): Record<CountryId, string[]> {
  const groups: Record<string, string[]> = {};
  const lookup =
    stateCountryMap instanceof Map
      ? (id: string) => stateCountryMap.get(id)
      : (id: string) => stateCountryMap[id];
  for (const id of stateIds) {
    const country = lookup(id);
    if (!country) continue;
    if (!groups[country]) groups[country] = [];
    groups[country].push(id);
  }
  return groups as Record<CountryId, string[]>;
}

/**
 * Get display label for a state ID, scoped by country.
 *
 * US states just use their 2-letter code (no entry needed); other countries
 * return a friendly name from the per-country table above. Falls back to the
 * raw stateId when no entry exists.
 *
 * `countryId` is required because some IDs collide across countries (DE HB
 * = Bremen, CN HB = Huabei). Callers without country context must establish
 * one before resolving the display name.
 */
export function getStateDisplayName(countryId: CountryId, stateId: string): string {
  // Last-resort fallback compacts a prefixed id (HU_BUD → BUD) rather than
  // leaking the raw composite key into display copy.
  return STATE_DISPLAY_NAMES[countryId]?.[stateId] ?? compactRegionCode(countryId, stateId);
}
