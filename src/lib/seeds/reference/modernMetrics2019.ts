import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { ruStateMetrics2027 } from "@/lib/countries/ru/data/ruStateMetrics2027";
import { huStateMetrics2027 } from "@/lib/countries/hu/data/huStateMetrics2027";
import { roStateMetrics2027 } from "@/lib/countries/ro/data/roStateMetrics2027";
import { SUCCESSOR_STATE_METRICS_1991 } from "./successorMetrics1991";
import { modernRegions2019, type Modern2019CountryId } from "./modernRegions2019";

/**
 * Observed 2019 national metrics. World Bank WDI indicators (replace POL with
 * RUS/HUN/ROU/BGR):
 * https://api.worldbank.org/v2/country/POL/indicator/NY.GDP.MKTP.KD.ZG?date=2019&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/SL.UEM.TOTL.ZS?date=2019&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/SP.DYN.LE00.IN?date=2019&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/SP.URB.TOTL.IN.ZS?date=2019&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/SP.DYN.CBRT.IN?date=2019&format=json
 * Other gameplay dimensions retain the nearest existing democratic-world
 * baseline until a full regional 2019 series is authored. They are fallbacks,
 * never represented as observations.
 */
const PROFILE = {
  RU: { growth: 2.198, unemployment: 4.513, life: 73.084, urban: 74.622, births: 10.1 },
  PL: { growth: 4.58, unemployment: 3.267, life: 77.905, urban: 59.963, births: 9.9 },
  HU: { growth: 5.077, unemployment: 3.411, life: 76.32, urban: 70.457, births: 9.6 },
  RO: { growth: 3.96, unemployment: 3.912, life: 75.607, urban: 52.893, births: 10.3 },
  BG: { growth: 3.793, unemployment: 4.148, life: 75.112, urban: 73.716, births: 9.3 },
} as const;

const MODERN_BASE: Partial<Record<Modern2019CountryId, StateMetrics[]>> = {
  RU: ruStateMetrics2027,
  HU: huStateMetrics2027,
  RO: roStateMetrics2027,
};

function mv(value: number): StateMetricValue {
  return { value };
}

export function modernMetrics2019(countryId: Modern2019CountryId): StateMetrics[] {
  const regions = modernRegions2019(countryId);
  const base =
    MODERN_BASE[countryId] ??
    SUCCESSOR_STATE_METRICS_1991.filter((metric) => metric.countryId === countryId);
  const byId = new Map(base.map((metric) => [String(metric._id), metric]));
  const profile = PROFILE[countryId];
  return regions.map((region) => {
    const prior = byId.get(String(region._id));
    if (!prior)
      throw new Error(`Missing democratic metric fallback for ${countryId}/${region._id}`);
    const income = Math.round(((region.gdp * 1_000_000) / region.population) * 0.42);
    return {
      ...prior,
      countryId,
      economic: {
        ...prior.economic,
        gdpGrowth: mv(profile.growth),
        unemploymentRate: mv(profile.unemployment),
        medianIncome: mv(income),
      },
      healthcare: { ...prior.healthcare, lifeExpectancy: mv(profile.life) },
      population: {
        ...prior.population,
        urbanizationRate: mv(profile.urban),
        birthRate: mv((profile.births / 30) * 100),
      },
    } as StateMetrics;
  });
}
