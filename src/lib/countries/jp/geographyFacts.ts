/**
 * Japan's small geographic scalars, in a module with NO value imports.
 *
 * ⚠ WHY THIS IS SEPARATE FROM `geography.ts`. That module imports all seven
 * eras of region, census, demographic and metric data as VALUES -- it is the
 * heaviest module in the folder. Two of these facts are read by registries that
 * client components import (`maps/countryAnchors`, `politicalStrength/
 * strengthConstants`), so sourcing them from `geography.ts` would pull Japan's
 * entire region dataset into the browser bundle to deliver three numbers.
 *
 * Nothing would fail. The page would just get much bigger, which is the same
 * silent failure `noClientBarrelImport.test.ts` exists to catch for the barrel.
 *
 * `geography.ts` re-exports these, so the conceptual home still reads right.
 * KEEP THIS MODULE FREE OF VALUE IMPORTS -- `clientSafeLeafModules.test.ts`
 * enforces that.
 */

/**
 * Map centroid Japan's country view opens on, as [longitude, latitude].
 *
 * ⚠ LONGITUDE FIRST. The table is GeoJSON-ordered, not lat/lng-ordered, so a
 * swapped pair puts Japan off the coast of Somalia without erroring.
 */
export const JP_MAP_ANCHOR: [number, number] = [138.3, 36.2];

/**
 * How many regions Japan's political-strength maths divides the country into.
 *
 * ⚠ EIGHT, NOT FORTY-SEVEN. This counts authored PLANNING regions, which is
 * what strength is computed over. The 47 prefectures are the seeded
 * administrative units, counted separately by the readiness audit
 * (`regionCount: 47`). Both numbers are right; merging them breaks one of them.
 */
export const JP_STRENGTH_REGION_COUNT = 8;

/**
 * Which regions border which, among Japan's eight planning regions.
 *
 * ⚠️ SYMMETRY IS NOT ENFORCED BY THE TYPE. `STATE_ADJACENCY` is
 * `Record<country, Record<region, region[]>>`, so listing TOH in HOK's
 * neighbours without listing HOK in TOH's is perfectly valid and quietly makes
 * adjacency directional. Edit both sides.
 */
export const JP_ADJACENCY_MAP: Record<string, string[]> = {
  HOK: ["TOH"],
  TOH: ["HOK", "KAN"],
  KAN: ["TOH", "CHU"],
  CHU: ["KAN", "KNS"],
  KNS: ["CHU", "CGK", "SHI"],
  CGK: ["KNS", "SHI", "KYU"],
  SHI: ["KNS", "CGK"],
  KYU: ["CGK"],
};

/**
 * Median-income anchors used to place Japan on the income curve, by year.
 */
export const JP_INCOME_ANCHORS = [
  {
    year: 1953,
    value: 700,
  },
  {
    year: 1979,
    value: 2900000,
  },
  {
    year: 1991,
    value: 4500000,
  },
  {
    year: 2019,
    value: 5500000,
  },
];

/**
 * Japan's per-metric normal anchors for the five core metrics.
 *
 * ⚠️ THESE ARE JAPAN'S SLICE OF A METRIC-FIRST REGISTRY. `CORE5_NORMALS` is
 * keyed by METRIC first and country second, and every metric also carries a
 * `global` fallback that every country without its own anchors uses. Japan's
 * slices moved; `global` did not, and must not.
 */
export const JP_CORE5_NORMALS = {
  gdpGrowth: [
    {
      year: 1953,
      value: 8,
    },
    {
      year: 1979,
      value: 5,
    },
    {
      year: 1991,
      value: 3.5,
    },
    {
      year: 2019,
      value: 0.8,
    },
    {
      year: 2040,
      value: 0.8,
    },
  ],
  unemploymentRate: [
    {
      year: 1953,
      value: 2,
    },
    {
      year: 1979,
      value: 2,
    },
    {
      year: 1991,
      value: 2.1,
    },
    {
      year: 2019,
      value: 2.4,
    },
    {
      year: 2040,
      value: 2.6,
    },
  ],
  lifeExpectancy: [
    {
      year: 1953,
      value: 63,
    },
    {
      year: 1979,
      value: 76,
    },
    {
      year: 1991,
      value: 79,
    },
    {
      year: 2019,
      value: 84.4,
    },
    {
      year: 2040,
      value: 87,
    },
  ],
  violentCrimeRate: [
    {
      year: 1953,
      value: 150,
    },
    {
      year: 1979,
      value: 80,
    },
    {
      year: 1991,
      value: 50,
    },
    {
      year: 2019,
      value: 25,
    },
    {
      year: 2040,
      value: 25,
    },
  ],
  povertyRate: [
    {
      year: 1953,
      value: 30,
    },
    {
      year: 1979,
      value: 12,
    },
    {
      year: 1991,
      value: 12,
    },
    {
      year: 2019,
      value: 15.5,
    },
    {
      year: 2040,
      value: 14,
    },
  ],
};

/** The continent Japan is filed under in the world tables. */
export const JP_CONTINENT = "Asia";

/**
 * Japan's ISO 3166-1 numeric code.
 *
 * ⚠️ THE ISO PAIR IS TWO REGISTRIES. `COUNTRY_TO_ISO_NUMERIC` and
 * `ISO_NUMERIC_TO_COUNTRY` are separate tables that both have to name 392. If
 * only one is updated, a lookup by code and a lookup by country disagree about
 * the same single fact, and neither errors.
 */
export const JP_ISO_NUMERIC = "392";
