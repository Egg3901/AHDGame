/**
 * Italy 1953 metric overlays — USD-anchored medianIncome (refs #3498).
 *
 * Modern `itStateMetrics` stores household income in lira millions; without an
 * era overlay those magnitudes leak into 1953-default. These overlays pin
 * medianIncome to ~$400–900 USD (Miracolo just starting; North richer than South),
 * matching the US/DE USD-anchored convention.
 */
import type { MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";

const IT_REGIONS = [
  "IT_NW",
  "IT_NE",
  "IT_TUS",
  "IT_LAZ",
  "IT_CAM",
  "IT_SUD",
  "IT_SIC",
  "IT_SAR",
] as const;

const NATIONAL_1953: Record<string, number> = {
  "economic.medianIncome": 550, // ≈ national household income, USD
  "economic.gdpGrowth": 6.5,
  "economic.unemploymentRate": 8.0,
  "infrastructure.powerGridReliability": 94, // % uptime; northern grid good, Mezzogiorno thin
  "infrastructure.roadCondition": 45, // war damage; northern roads far ahead of the south
  "environment.protectedLand": 1.4, // % of land; Gran Paradiso (1922) and Abruzzo only
  "infrastructure.waterQuality": 70, // treated-supply index; sharp north-south gap
  "infrastructure.broadbandAccess": 0, // the internet did not exist
  "economic.povertyRate": 28,
  "healthcare.lifeExpectancy": 66,
  "healthcare.nhsWaitingTime": 15, // weeks; fragmented mutue with a sharp north-south gap; the SSN is 25 years away
  "population.urbanizationRate": 42,
  "population.medianAge": 30,
  // 0-100 fertility INDEX (population.birthRate; metricDefinitions
  // `unit: "index"`), NOT a crude per-1000 rate. Real Italy 1953 TFR ≈2.3
  // (ISTAT) — birthRateIndexToTFR(60, 2.06) = 2.06*(0.4+0.6*1.2) = 2.27. This
  // field was previously ABSENT, so IT fell through seedCohortVectors'
  // DEFAULT_BIRTH_RATE = 50 (TFR 2.06) — modestly understating the still-
  // above-replacement early-1950s Italian fertility, before the Miracolo-era
  // fertility decline of the 1960s-70s.
  "population.birthRate": 60,
};

const TILTS_1953: Record<string, Record<string, number>> = {
  IT_NW: {
    // Industrial triangle (Milan/Turin/Genoa)
    "economic.medianIncome": 900,
    "economic.unemploymentRate": 5.0,
    "economic.povertyRate": 18,
    "population.urbanizationRate": 58,
  },
  IT_NE: {
    "economic.medianIncome": 780,
    "economic.unemploymentRate": 6.0,
    "economic.povertyRate": 20,
    "population.urbanizationRate": 48,
  },
  IT_TUS: {
    "economic.medianIncome": 650,
    "economic.unemploymentRate": 7.0,
    "economic.povertyRate": 24,
  },
  IT_LAZ: {
    // Rome / capital
    "economic.medianIncome": 700,
    "economic.unemploymentRate": 6.5,
    "population.urbanizationRate": 55,
  },
  IT_CAM: {
    "economic.medianIncome": 420,
    "economic.unemploymentRate": 12.0,
    "economic.povertyRate": 38,
    "population.urbanizationRate": 40,
  },
  IT_SUD: {
    "economic.medianIncome": 380,
    "economic.unemploymentRate": 14.0,
    "economic.povertyRate": 42,
    "population.urbanizationRate": 32,
  },
  IT_SIC: {
    "economic.medianIncome": 360,
    "economic.unemploymentRate": 15.0,
    "economic.povertyRate": 45,
  },
  IT_SAR: {
    "economic.medianIncome": 340,
    "economic.unemploymentRate": 13.0,
    "economic.povertyRate": 40,
    "population.urbanizationRate": 28,
  },
};

export const itMetricPresets1953: MetricPresetBundle = Object.fromEntries(
  IT_REGIONS.map((region) => [region, { ...NATIONAL_1953, ...(TILTS_1953[region] ?? {}) }])
);
