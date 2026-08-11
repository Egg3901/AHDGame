/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data (e.g. the 2019 `sectorSeedWeights` array). All values are
 * authored for 2023 directly. Changing the 2019 (or any other) seed must never
 * alter 2023. Same-era imports (states2023 for region IDs) and type-only
 * imports are allowed.
 */

/**
 * 2023-era national sector weights, US only.
 *
 * Numbers are relative percentage-of-GDP allocations across the 17 game sectors,
 * calibrated to 2023 BEA value-added shares. Relative to the 2019-default bundle:
 *   - technology +2 (platform software, cloud, AI services now ~9–10% of GDP)
 *   - healthcare +1 (persistent post-COVID demand, now ~10% of private GDP)
 *   - manufacturing -2 (continued structural decline; offshoring accelerated)
 * All weights are normalised at read time, so only relative magnitudes matter.
 *
 * Other countries remain on the 2019-default weights until country-specific
 * 2023 data is authored. `getCountrySectorWeights2023` returns an even
 * distribution for any country not in the map.
 */

import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";

type SectorWeightMap = Partial<Record<CorporationType, number>>;

export const COUNTRY_SECTOR_WEIGHTS_2023: Record<string, SectorWeightMap> = {
  US: {
    real_estate: 14,
    technology: 11,
    healthcare: 10,
    financial: 10,
    manufacturing: 7,
    retail: 7,
    construction: 6,
    logistics: 5,
    chemical_industries: 4,
    automobiles: 4,
    defense: 4,
    media: 4,
    telecommunications: 4,
    energy: 3,
    entertainment: 3,
    agriculture: 2,
    extraction: 2,
  },
};

/**
 * Returns the 2023 country-level sector weight map.
 * Used by `getStateSectorWeights` when the active preset is `2023-default`.
 */
export function getCountrySectorWeights2023(countryId: CountryId): Record<CorporationType, number> {
  const raw = COUNTRY_SECTOR_WEIGHTS_2023[countryId] ?? {};
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
