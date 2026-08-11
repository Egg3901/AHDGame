/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data. All values are authored for 1999 directly.
 * Type-only imports are allowed.
 */

/**
 * 1999-era national sector weights, US only.
 *
 * Relative percentage-of-GDP allocations across the 17 game sectors, calibrated
 * to 1999 BEA value-added shares — a *dot-com + telecom boom, pre-China-WTO*
 * economy. Relative to the 2007/2019/2023 bundles:
 *   - manufacturing notably higher (~15% of GDP; offshoring hadn't accelerated)
 *   - telecommunications elevated (Telecom Act 1996 fiber/CLEC buildout, the
 *     telecom bubble) and technology high (dot-com investment surge)
 *   - automobiles higher (Big Three strength pre-2008)
 *   - defense at its post-Cold-War LOW (the "peace dividend")
 *   - energy/extraction LOW (1999 oil ≈ $17/bbl)
 *   - real_estate below the mid-2000s bubble level
 * All weights are normalised at read time, so only relative magnitudes matter.
 *
 * Other countries remain on the 2019-default weights until country-specific
 * 1999 data is authored. `getCountrySectorWeights1999` returns an even
 * distribution for any country not in the map.
 */

import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";

type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_1999: Record<string, SectorWeightMap> = {
  US: {
    real_estate: 13,
    manufacturing: 12,
    financial: 9,
    technology: 8,
    healthcare: 7,
    retail: 7,
    telecommunications: 6,
    automobiles: 6,
    construction: 5,
    chemical_industries: 5,
    media: 4,
    logistics: 4,
    energy: 3,
    defense: 3,
    entertainment: 3,
    agriculture: 2,
    extraction: 2,
  },
};

/**
 * Returns the 1999 country-level sector weight map.
 * Used by `getStateSectorWeights` when the active preset is `1999-default`.
 */
export function getCountrySectorWeights1999(countryId: CountryId): Record<CorporationType, number> {
  const raw = COUNTRY_SECTOR_WEIGHTS_1999[countryId] ?? {};
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
