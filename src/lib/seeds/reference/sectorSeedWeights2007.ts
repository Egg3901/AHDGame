/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 2007 directly.
 * Type-only imports are allowed.
 */

/**
 * 2007-era national sector weights, US only.
 *
 * Relative percentage-of-GDP allocations across the 17 game sectors, calibrated
 * to 2007 BEA value-added shares — a *pre-Great-Recession, housing-bubble-peak,
 * pre-smartphone* economy. Relative to the 2023-default bundle:
 *   - real_estate + construction elevated (residential bubble at its 2006–07 peak)
 *   - financial elevated (pre-crash leverage / securitization peak)
 *   - manufacturing materially higher (offshoring not yet at 2010s pace)
 *   - automobiles higher (Big Three still pre-bankruptcy)
 *   - energy/extraction higher (2007–08 oil & commodity run-up)
 *   - technology lower (pre-iPhone-mass-adoption, pre-cloud, pre-platform-era)
 *   - healthcare lower (pre-ACA expansion)
 * All weights are normalised at read time, so only relative magnitudes matter.
 *
 * Other countries remain on the 2019-default weights until country-specific
 * 2007 data is authored. `getCountrySectorWeights2007` returns an even
 * distribution for any country not in the map.
 */

import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";

type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_2007: Record<string, SectorWeightMap> = {
  US: {
    real_estate: 15,
    financial: 11,
    manufacturing: 10,
    healthcare: 8,
    technology: 7,
    retail: 7,
    construction: 7,
    logistics: 5,
    automobiles: 5,
    defense: 4,
    energy: 4,
    media: 4,
    telecommunications: 4,
    chemical_industries: 4,
    extraction: 3,
    entertainment: 3,
    agriculture: 2,
  },
};

/**
 * Returns the 2007 country-level sector weight map.
 * Used by `getStateSectorWeights` when the active preset is `2007-default`.
 */
export function getCountrySectorWeights2007(countryId: CountryId): Record<CorporationType, number> {
  const raw = COUNTRY_SECTOR_WEIGHTS_2007[countryId] ?? {};
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
