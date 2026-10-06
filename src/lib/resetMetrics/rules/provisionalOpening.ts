/**
 * Provisional 1991 regional opening values for the reset design. These are
 * game-calibrated estimates, not historical observations or live turn rules.
 * Plain inputs and outputs let the headless harness and reset shell share them.
 */
import { primaryMetricById } from "../catalog";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { OpeningMetricObservation } from "./openingObservation";

export type OpeningCountry = "US" | "UK" | "JP" | "IE";

export interface ProvisionalRegionInput {
  regionId: string;
  population: number;
  medianIncome: number | null;
  costOfLiving: number | null;
  rdIntensity: number | null;
  workforceSkill: number | null;
  universityEnrollment: number | null;
  uninsuredRate: number | null;
  physicianRate: number | null;
  publicHealthPreparedness: number | null;
  lifeExpectancy: number | null;
  housingAffordability: number | null;
  publicTrust: number | null;
  populationGrowth: number | null;
}

export const provisionalRegionalIds = ["02", "15", "16", "18", "20", "24", "49", "54"] as const;

// National observations anchor regional shape. The regional deviations and
// the remaining component estimates are provisional, not historical series.
export const opening1991Anchors: Record<
  OpeningCountry,
  { lifeYears: number; growthPercent: number }
> = {
  US: { lifeYears: 75.5, growthPercent: 1.33626074073779 },
  UK: { lifeYears: 76.0829268292683, growthPercent: 0.309247932319381 },
  JP: { lifeYears: 79.0368292682927, growthPercent: 0.392819832481862 },
  IE: { lifeYears: 74.8, growthPercent: 0.250480411451676 },
};

function valid(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function weightedMean(
  rows: readonly ProvisionalRegionInput[],
  value: (row: ProvisionalRegionInput) => number | null
): number | null {
  let sum = 0;
  let population = 0;
  for (const row of rows) {
    const current = value(row);
    if (!valid(current) || !valid(row.population) || row.population <= 0) return null;
    sum += current * row.population;
    population += row.population;
  }
  return population > 0 ? sum / population : null;
}

function positiveRatio(a: number | null, b: number | null): number | null {
  return valid(a) && a > 0 && valid(b) && b > 0 ? a / b : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function proxy(
  id: string,
  value: number | null,
  source: string,
  note: string
): OpeningMetricObservation {
  const metric = primaryMetricById(id);
  if (!metric) throw new Error(`unknown reset metric ${id}`);
  return {
    metricId: id,
    path: metric.path,
    value: valid(value) ? value : null,
    status: valid(value) ? "proxy" : "unavailable",
    source: valid(value) ? `provisional 1991 game estimate: ${source}` : "none",
    owner: metric.owner,
    note: valid(value)
      ? `${note} Opening estimate only; ${metric.owner} must replace it with an owned turn calculation.`
      : `Missing or invalid input for provisional ${metric.name.toLowerCase()} estimate.`,
  };
}

/** Never provides national energy security or any other unreviewed metric. */
export function provisionalRegionalOpening(
  country: OpeningCountry,
  rows: readonly ProvisionalRegionInput[]
): ReadonlyMap<string, Record<string, OpeningMetricObservation>> {
  if (new Set(rows.map((row) => row.regionId)).size !== rows.length) {
    throw new Error("duplicate region in provisional opening inputs");
  }
  const purchasing = (row: ProvisionalRegionInput) =>
    positiveRatio(row.medianIncome, row.costOfLiving);
  const research = (row: ProvisionalRegionInput) => {
    const rd = row.rdIntensity;
    const skill = row.workforceSkill;
    const enrollment = row.universityEnrollment;
    return valid(rd) && rd > 0 && valid(skill) && skill > 0 && valid(enrollment) && enrollment > 0
      ? rd * (skill / 100) * (enrollment / 100)
      : null;
  };
  const purchaseMean = weightedMean(rows, purchasing);
  const researchMean = weightedMean(rows, research);
  const doctorMean = weightedMean(rows, (row) => row.physicianRate);
  const preparednessMean = weightedMean(rows, (row) => row.publicHealthPreparedness);
  const lifeMean = weightedMean(rows, (row) => row.lifeExpectancy);
  const housingMean = weightedMean(rows, (row) => row.housingAffordability);
  const growthMean = weightedMean(rows, (row) => row.populationGrowth);
  return new Map(
    rows.map((row) => {
      const purchase = purchasing(row);
      const capacity = research(row);
      const doctorRatio = positiveRatio(row.physicianRate, doctorMean);
      const preparednessRatio = positiveRatio(row.publicHealthPreparedness, preparednessMean);
      const serviceReach =
        doctorRatio !== null && preparednessRatio !== null
          ? clamp(94 + 20 * (0.6 * doctorRatio + 0.4 * preparednessRatio - 1), 75, 100)
          : null;
      // National entitlement in UK/JP is not inferred from the uniform v1
      // uninsuredRate seed. US opening eligibility uses its actual game field.
      const eligibility =
        country === COUNTRY_CONFIGS.US.id && valid(row.uninsuredRate)
          ? clamp(100 - row.uninsuredRate, 0, 100)
          : country === COUNTRY_CONFIGS.US.id
            ? null
            : 100;
      const delay =
        doctorRatio !== null && preparednessRatio !== null
          ? clamp(20 / Math.pow(doctorRatio, 0.6) / Math.pow(preparednessRatio, 0.4), 5, 60)
          : null;
      const housingRatio = positiveRatio(row.housingAffordability, housingMean);
      // US legacy affordability is uniform across its 51 rows, so its
      // regional opening pattern uses the inverse income-to-cost ratio. UK/JP
      // authored seeds contain varying price-to-income multiples.
      const housing =
        country === COUNTRY_CONFIGS.US.id
          ? purchase !== null && purchaseMean !== null
            ? (100 * purchaseMean) / purchase
            : null
          : housingRatio === null
            ? null
            : 100 * housingRatio;
      const observations: Record<string, OpeningMetricObservation> = {
        "02": proxy(
          "02",
          purchase !== null ? 100 * purchase : null,
          "gross median income / relative cost-of-living index",
          "Annual real household income in local currency at constant 1991 prices. Taxes, transfers, and basket detail are not yet included."
        ),
        "15": proxy(
          "15",
          capacity !== null && researchMean !== null ? (100 * capacity) / researchMean : null,
          "R&D intensity, workforce skills, and tertiary enrollment",
          "Country-normalized capacity indicator, not measured laboratories or research output."
        ),
        "16": proxy(
          "16",
          eligibility !== null && serviceReach !== null
            ? Math.min(eligibility, serviceReach)
            : null,
          "eligibility and physician/preparedness service-reach estimate",
          "Estimated effective coverage. Service reach is calibrated to 94% at the country mean; it is not observed patient access."
        ),
        "18": proxy(
          "18",
          delay,
          "physician density and public-health preparedness",
          "Country-relative treatment-delay index centered on 20, not waiting days. The UK keeps its separate NHS wait proxy."
        ),
        "20": proxy(
          "20",
          valid(row.lifeExpectancy) && valid(lifeMean)
            ? opening1991Anchors[country].lifeYears + 0.5 * (row.lifeExpectancy - lifeMean)
            : null,
          "1991 country life-expectancy anchor plus regional legacy deviation",
          "Regional legacy deviation is halved for a conservative game estimate, not a regional life table; future values require age-specific mortality."
        ),
        "24": proxy(
          "24",
          housing,
          country === COUNTRY_CONFIGS.US.id
            ? "inverse gross-income-to-cost ratio"
            : "legacy price-to-income multiple",
          "Country-normalized housing burden index, not observed mortgage/rent payments."
        ),
        "49": proxy(
          "49",
          valid(row.publicTrust) ? clamp(row.publicTrust, 0, 100) : null,
          "era-adjusted legacy public-trust index",
          "Gameplay perception seed, not a 1991 opinion survey or a direct law effect."
        ),
        "54": proxy(
          "54",
          valid(row.populationGrowth) && valid(growthMean)
            ? opening1991Anchors[country].growthPercent + row.populationGrowth - growthMean
            : null,
          "1991 country population-change anchor plus regional legacy deviation",
          "Regional pattern is game-calibrated; future change must reconcile births, deaths, and migration."
        ),
      };
      return [row.regionId, observations] as const;
    })
  );
}
