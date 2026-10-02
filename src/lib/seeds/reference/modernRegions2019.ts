import type { State } from "@/lib/db/types";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { ruRegions2027 } from "@/lib/countries/ru/data/ruRegions2027";
import { plRegions2027 } from "@/lib/countries/pl/data/plRegions2027";
import { huRegions2027 } from "@/lib/countries/hu/data/huRegions2027";
import { roRegions2027 } from "@/lib/countries/ro/data/roRegions2027";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";

/**
 * January 2019 national population and current-price GDP in local currency.
 * World Bank population SP.POP.TOTL and GDP NY.GDP.MKTP.CN, year 2019:
 * https://api.worldbank.org/v2/country/RUS;POL;HUN;ROU;BGR/indicator/SP.POP.TOTL?date=2019&format=json
 * https://api.worldbank.org/v2/country/RUS;POL;HUN;ROU;BGR/indicator/NY.GDP.MKTP.CN?date=2019&format=json
 *
 * Bulgaria's GDP uses Eurostat's 2019 BGN 120,395 million national-account
 * total; the previously transcribed 61,194 million figure was euro-scale and
 * would halve every lev-denominated regional and fiscal amount.
 * https://ec.europa.eu/eurostat/documents/2995521/11563331/2-21102021-AP-EN.pdf/257365fa-8a66-cab8-f60c-06ca9c916a7a
 * The project has game macroregions, not official 2019 GDP series for each.
 * Their within-country shares use the nearest existing democratic region
 * layout and are rescaled to these observed national totals. These shares are
 * explicitly model estimates, not claims of observed regional GDP in 2019.
 */
export const MODERN_2019_NATIONALS = {
  RU: { population: 145_453_291, gdp: 109_608_300_000_000 },
  PL: { population: 37_965_475, gdp: 2_313_929_000_000 },
  HU: { population: 9_694_824, gdp: 47_940_496_000_000 },
  RO: { population: 19_371_648, gdp: 1_059_822_100_000 },
  BG: { population: 6_616_726, gdp: 120_395_000_000 },
} as const;

export type Modern2019CountryId = keyof typeof MODERN_2019_NATIONALS;

const BASE_REGIONS: Record<Modern2019CountryId, readonly State[]> = {
  RU: ruRegions2027,
  PL: plRegions2027,
  HU: huRegions2027,
  RO: roRegions2027,
  // The 2019 game defines five BG macroregions. The six-region 2027 NSI
  // layout cannot be retroactively applied without changing 2019 seat IDs.
  BG: bgRegions1991,
};

/** Deterministic largest-remainder distribution; preserves the exact total. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((n, value) => n + value, 0);
  if (!(sum > 0)) throw new Error("2019 region weights must have a positive total");
  const exact = weights.map((weight) => (weight / sum) * total);
  const out = exact.map(Math.floor);
  const order = exact
    .map((value, index) => ({ index, fraction: value - out[index]! }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const remainder = total - out.reduce((n, value) => n + value, 0);
  for (let i = 0; i < remainder; i++) {
    out[order[i]!.index] = out[order[i]!.index]! + 1;
  }
  return out;
}

export function modernRegions2019(countryId: Modern2019CountryId): State[] {
  const base = BASE_REGIONS[countryId];
  const national = MODERN_2019_NATIONALS[countryId];
  const population = allocate(
    national.population,
    base.map((region) => region.population ?? 0)
  );
  const gdpMillions = allocate(
    Math.round(national.gdp / 1_000_000),
    base.map((region) => region.gdp ?? 0)
  );
  const houseSeats =
    countryId === "RU"
      ? 450
      : countryId === "PL"
        ? 460
        : countryId === "HU"
          ? 199
          : countryId === "RO"
            ? 329
            : 240;
  const senateSeats = countryId === "PL" ? 100 : countryId === "RO" ? 136 : 0;
  const weights = Object.fromEntries(
    base.map((region, index) => [String(region._id), population[index]!])
  );
  const house = apportionSeats(houseSeats, weights);
  const senate = senateSeats > 0 ? apportionSeats(senateSeats, weights) : {};
  return base.map((region, index) => ({
    ...region,
    population: population[index]!,
    gdp: gdpMillions[index]!,
    houseDistricts: house[String(region._id)]!,
    stateSenateSeats: senate[String(region._id)] ?? 0,
  }));
}
