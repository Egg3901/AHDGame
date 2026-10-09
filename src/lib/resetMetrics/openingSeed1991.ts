/** Read-only 1991 reset observations. No database, player data, or seed writes. */
import {
  stateMetrics1991,
  applyEra1991Adjustments,
} from "@/lib/countries/us/data/usStateMetrics1991";
import { ukStateMetrics } from "@/lib/countries/uk/data/ukStateMetrics";
import { jpStateMetrics } from "@/lib/countries/jp/data/jpStateMetrics";
import { ieStateMetrics } from "@/lib/countries/ie/data/ieStateMetrics";
import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import { ieRegions1991 } from "@/lib/countries/ie/data/ieRegions1991";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { synthesizeAgeSexVector } from "@/lib/demographics/seedSynthesis";
import { buildCountryRoster } from "@/lib/admin/seed/seedMilitaryUnits";
import { openingDependencyCohorts } from "./rules/cohortOpening";
import { nationalForceReadiness } from "./rules/forceReadiness";
import { rebaseOpeningFertility } from "./rules/fertilityOpening";
import { provisionalRegionalOpening } from "./rules/provisionalOpening";
import { opening1991Anchors } from "./rules/provisionalOpening";
import { periodLifeExpectancy } from "./rules/periodLifeExpectancy";
import {
  provisionalFuelOpening,
  type ProvisionalFuelOpeningInput,
} from "./rules/provisionalFuelOpening";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { openingFiscalBooks1991 } from "@/lib/resetFinance/opening1991";
import { applyMetricPresetToMetrics, getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { primaryMetrics } from "./catalog";
import {
  buildOpeningMetricObservation,
  type OpeningMetricObservation,
} from "./rules/openingObservation";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";

type Country = "US" | "UK" | "JP" | "IE";
const bundles = {
  US: stateMetrics1991,
  UK: ukStateMetrics.map(applyEra1991Adjustments),
  JP: jpStateMetrics.map(applyEra1991Adjustments),
  IE: ieStateMetrics.map(applyEra1991Adjustments),
} as const;
const regions = {
  US: states1991,
  UK: ukRegions1991,
  JP: jpRegions1991,
  IE: ieRegions1991,
} as const;
const delayProxyPath: Record<Country, string | null> = {
  US: null,
  UK: "healthcare.nhsWaitingTime",
  JP: null,
  IE: "healthcare.hseWaitingListMonths",
};
// Design's 1991 national TFR anchors: US CDC 2.07, UK ONS 1.82, JP Statistics
// Bureau 1.53. This rebase affects v2 observations only, not v1 seed writers.
const openingNationalTfr: Record<Country, number> = { US: 2.07, UK: 1.82, JP: 1.53, IE: 2.09 };

/** Gameplay assumptions, not reconstructed 1991 national energy accounts. */
export const opening1991FuelAssumptions: Readonly<Record<Country, ProvisionalFuelOpeningInput>> = {
  US: { importExposurePercent: 40, emergencyBufferDays: 85, sourceDiversity: 62 },
  UK: { importExposurePercent: 12, emergencyBufferDays: 90, sourceDiversity: 65 },
  JP: { importExposurePercent: 88, emergencyBufferDays: 110, sourceDiversity: 43 },
  IE: { importExposurePercent: 70, emergencyBufferDays: 80, sourceDiversity: 55 },
};

function rawValue(row: StateMetrics, path: string): number | null {
  const [category, field] = path.split(".");
  const section = (row as unknown as Record<string, Record<string, { value?: unknown }>>)[category];
  const value = section?.[field]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Fixed regional 1991 gross-income and basket ratios for a provisional turn proxy. */
export function openingGrossPurchasingInputs1991(): Record<
  Country,
  Record<string, { medianIncome: number; basketIndex: number; openingIndex: number }>
> {
  return Object.fromEntries(
    (Object.keys(bundles) as Country[]).map((country) => {
      const inputs = Object.fromEntries(
        bundles[country].map((raw) => {
          const regionId = String(raw._id);
          const overlay = getRegionMetricPresets(country, regionId, "1991-default");
          const row = overlay ? applyMetricPresetToMetrics(raw, overlay) : raw;
          const medianIncome = rawValue(row, "economic.medianIncome");
          const basketIndex = rawValue(row, "economic.costOfLiving");
          if (!medianIncome || medianIncome <= 0 || !basketIndex || basketIndex <= 0) {
            throw new Error(
              `Missing 1991 purchasing-power proxy inputs for ${country}:${regionId}`
            );
          }
          return [regionId, { medianIncome, basketIndex }];
        })
      ) as Record<string, { medianIncome: number; basketIndex: number }>;
      let weighted = 0;
      let population = 0;
      for (const region of regions[country]) {
        const source = inputs[region._id];
        if (!source || region.population <= 0) {
          throw new Error(`Missing 1991 purchasing-power weight for ${country}:${region._id}`);
        }
        weighted += (source.medianIncome / source.basketIndex) * region.population;
        population += region.population;
      }
      const reference = weighted / population;
      return [
        country,
        Object.fromEntries(
          Object.entries(inputs).map(([regionId, source]) => [
            regionId,
            {
              ...source,
              openingIndex: (100 * (source.medianIncome / source.basketIndex)) / reference,
            },
          ])
        ),
      ];
    })
  ) as Record<
    Country,
    Record<string, { medianIncome: number; basketIndex: number; openingIndex: number }>
  >;
}

/** Historical regional anchor plus the mortality model's seed-era reference. */
export function openingLifeCalibration1991(): Record<
  Country,
  Record<string, { openingYears: number; modeledYears: number }>
> {
  return Object.fromEntries(
    (Object.keys(bundles) as Country[]).map((country) => {
      const shapeRows =
        country === COUNTRY_CONFIGS.UK.id
          ? ukStateMetrics
          : country === COUNTRY_CONFIGS.JP.id
            ? jpStateMetrics
            : country === "IE"
              ? ieStateMetrics
              : stateMetrics1991;
      const rawById = new Map(shapeRows.map((row) => [String(row._id), row]));
      const populationById = new Map(
        regions[country].map((region) => [region._id, region.population])
      );
      let weightedLife = 0;
      let population = 0;
      for (const row of shapeRows) {
        const regionId = String(row._id);
        const weight = populationById.get(regionId);
        const life = rawValue(row, "healthcare.lifeExpectancy");
        if (!weight || weight <= 0 || life === null) {
          throw new Error(`Missing 1991 life calibration ${country}:${regionId}`);
        }
        weightedLife += life * weight;
        population += weight;
      }
      if (shapeRows.length !== populationById.size || population <= 0) {
        throw new Error(`Incomplete 1991 life calibration ${country}`);
      }
      const mean = weightedLife / population;
      return [
        country,
        Object.fromEntries(
          bundles[country].map((raw) => {
            const regionId = String(raw._id);
            const life = rawValue(rawById.get(regionId) ?? raw, "healthcare.lifeExpectancy");
            const overlay = getRegionMetricPresets(country, regionId, "1991-default");
            const row = overlay ? applyMetricPresetToMetrics(raw, overlay) : raw;
            const preventable = rawValue(row, "healthcare.preventableMortality");
            if (life === null || preventable === null) {
              throw new Error(`Missing 1991 mortality input ${country}:${regionId}`);
            }
            return [
              regionId,
              {
                openingYears: opening1991Anchors[country].lifeYears + 0.5 * (life - mean),
                modeledYears: periodLifeExpectancy({
                  lifeExpectancy: life,
                  preventableMortality: preventable,
                }),
              },
            ];
          })
        ),
      ];
    })
  ) as Record<Country, Record<string, { openingYears: number; modeledYears: number }>>;
}

/** Cohort-policy input matching the v2 reset's official national TFR anchors. */
export function openingFertilityPolicyInputs1991(): Record<Country, Record<string, number>> {
  return Object.fromEntries(
    (Object.keys(bundles) as Country[]).map((country) => {
      const populationById = new Map(
        regions[country].map((region) => [region._id, region.population])
      );
      const rebased = rebaseOpeningFertility(
        bundles[country].map((raw) => {
          const regionId = String(raw._id);
          const overlay = getRegionMetricPresets(country, regionId, "1991-default");
          const row = overlay ? applyMetricPresetToMetrics(raw, overlay) : raw;
          return {
            regionId,
            population: populationById.get(regionId) ?? Number.NaN,
            legacyBirthRateIndex: rawValue(row, "population.birthRate") ?? Number.NaN,
          };
        }),
        openingNationalTfr[country]
      );
      if (rebased.regions.length !== populationById.size) {
        throw new Error(`Incomplete 1991 fertility input roster for ${country}`);
      }
      return [
        country,
        Object.fromEntries(
          rebased.regions.map((region) => [region.regionId, region.openingBirthRateIndex])
        ),
      ];
    })
  ) as Record<Country, Record<string, number>>;
}

/** Frozen 1991 international-flow policy starting point, not realized migration. */
export function openingMigrationPolicyInputs1991(): Record<Country, Record<string, number>> {
  return Object.fromEntries(
    (Object.keys(bundles) as Country[]).map((country) => {
      const entries = bundles[country].map((raw) => {
        const regionId = String(raw._id);
        const overlay = getRegionMetricPresets(country, regionId, "1991-default");
        const row = overlay ? applyMetricPresetToMetrics(raw, overlay) : raw;
        const policyRate = rawValue(row, "population.migrationRate");
        if (policyRate === null) {
          throw new Error(`Missing 1991 migration policy input ${country}:${regionId}`);
        }
        return [regionId, policyRate] as const;
      });
      if (entries.length !== regions[country].length) {
        throw new Error(`Incomplete 1991 migration input roster for ${country}`);
      }
      return [country, Object.fromEntries(entries)];
    })
  ) as Record<Country, Record<string, number>>;
}

/** Fixed 1991 denominators for the v2 health-access proxy, not observed service slots. */
export function openingHealthProxyReferences1991(): Record<
  Country,
  { physicianRate: number; preparedness: number }
> {
  return Object.fromEntries(
    (Object.keys(bundles) as Country[]).map((country) => {
      let population = 0;
      let physician = 0;
      let preparedness = 0;
      const weights = new Map(regions[country].map((region) => [region._id, region.population]));
      for (const raw of bundles[country]) {
        const regionId = String(raw._id);
        const overlay = getRegionMetricPresets(country, regionId, "1991-default");
        const row = overlay ? applyMetricPresetToMetrics(raw, overlay) : raw;
        const weight = weights.get(regionId);
        const doctorValue = rawValue(row, "healthcare.physicianRate");
        const preparednessValue = rawValue(row, "healthcare.publicHealthPreparedness");
        if (
          !weight ||
          weight <= 0 ||
          doctorValue === null ||
          doctorValue <= 0 ||
          preparednessValue === null ||
          preparednessValue <= 0
        ) {
          throw new Error(`Missing 1991 health proxy reference for ${country}:${regionId}`);
        }
        population += weight;
        physician += doctorValue * weight;
        preparedness += preparednessValue * weight;
      }
      if (population <= 0 || weights.size !== bundles[country].length) {
        throw new Error(`Incomplete 1991 health proxy reference for ${country}`);
      }
      return [
        country,
        { physicianRate: physician / population, preparedness: preparedness / population },
      ];
    })
  ) as Record<Country, { physicianRate: number; preparedness: number }>;
}

export interface MetricSeedAuditRow {
  country: Country;
  regionId: string;
  observed: number;
  provisional: number;
  unavailable: string[];
  openingValues: Record<string, number | null>;
  openingObservations: Record<string, OpeningMetricObservation>;
}

/** Fiscal primaries are national observations, not copies of regional scores. */
export function openingNationalFiscalObservations1991(): Record<
  Country,
  { balance: OpeningMetricObservation; debt: OpeningMetricObservation }
> {
  const books = openingFiscalBooks1991();
  return Object.fromEntries(
    (Object.keys(books) as Country[]).map((country) => {
      const book = books[country];
      return [
        country,
        {
          balance: buildOpeningMetricObservation("09", {
            ownerValue: (book.annualBalance / book.gdp) * 100,
          }),
          debt: buildOpeningMetricObservation("10", {
            ownerValue: (book.debt / book.gdp) * 100,
          }),
        },
      ];
    })
  ) as Record<Country, { balance: OpeningMetricObservation; debt: OpeningMetricObservation }>;
}

/** Separate national observations; never duplicate these into regional rows. */
export function auditOpeningNationalMetricSources1991(): Record<
  Country,
  Record<string, OpeningMetricObservation>
> {
  const fiscal = openingNationalFiscalObservations1991();
  const inflation = new Map(
    getInitialNationalBudgetsForPreset("1991-default")
      .filter(
        (budget) =>
          budget.countryId === "US" ||
          budget.countryId === "UK" ||
          budget.countryId === "JP" ||
          budget.countryId === "IE"
      )
      .map((budget) => [budget.countryId, budget.economicFactors.inflationRate])
  );
  const forCountry = (country: Country): Record<string, OpeningMetricObservation> => ({
    "07": buildOpeningMetricObservation("07", {
      annualCpiChange: inflation.get(country),
      cpiVolatility48: 0,
    }),
    "09": fiscal[country].balance,
    "10": fiscal[country].debt,
    "57": buildOpeningMetricObservation("57", {
      ownerValue: nationalForceReadiness(
        buildCountryRoster(
          country,
          regions[country].map((region) => region._id),
          1,
          "1991",
          1991
        ),
        1
      ),
    }),
    "58": provisionalFuelOpening(opening1991FuelAssumptions[country]),
  });
  return { US: forCountry("US"), UK: forCountry("UK"), JP: forCountry("JP"), IE: forCountry("IE") };
}

export function auditOpeningMetricSources(): MetricSeedAuditRow[] {
  const result: MetricSeedAuditRow[] = [];
  // National observations belong to one country ledger/owner. Copying them to
  // every region would create false regional data and inflate source coverage.
  const regionalMetrics = primaryMetrics.filter((metric) => metric.aggregation !== "national");
  const auditedCountries = new Set<string>(Object.keys(bundles));
  const inflationByCountry = new Map(
    getInitialNationalBudgetsForPreset("1991-default")
      .filter((budget) => auditedCountries.has(budget.countryId))
      .map((budget) => [budget.countryId, budget.economicFactors.inflationRate])
  );
  for (const country of Object.keys(bundles) as Country[]) {
    const regionById = new Map(regions[country].map((region) => [region._id, region]));
    // The shared US era adjustment clamps UK/JP life expectancy to a US band.
    // For v2 only, retain each country's authored regional pattern and rebase
    // its mean to that country's sourced 1991 life-expectancy anchor.
    const lifeShapeRows =
      country === COUNTRY_CONFIGS.UK.id
        ? ukStateMetrics
        : country === COUNTRY_CONFIGS.JP.id
          ? jpStateMetrics
          : country === "IE"
            ? ieStateMetrics
            : stateMetrics1991;
    const lifeShapeById = new Map(lifeShapeRows.map((row) => [String(row._id), row]));
    const adjustedRows = bundles[country].map((raw) => {
      const overlay = getRegionMetricPresets(country, String(raw._id), "1991-default");
      return overlay ? applyMetricPresetToMetrics(raw, overlay) : raw;
    });
    const provisional = provisionalRegionalOpening(
      country,
      adjustedRows.map((row) => ({
        regionId: String(row._id),
        population: regionById.get(String(row._id))?.population ?? 0,
        medianIncome: rawValue(row, "economic.medianIncome"),
        costOfLiving: rawValue(row, "economic.costOfLiving"),
        rdIntensity: rawValue(row, "economic.rdIntensity"),
        workforceSkill: rawValue(row, "education.workforceSkill"),
        universityEnrollment: rawValue(row, "education.universityEnrollment"),
        uninsuredRate: rawValue(row, "healthcare.uninsuredRate"),
        physicianRate: rawValue(row, "healthcare.physicianRate"),
        publicHealthPreparedness: rawValue(row, "healthcare.publicHealthPreparedness"),
        lifeExpectancy: rawValue(
          lifeShapeById.get(String(row._id)) ?? row,
          "healthcare.lifeExpectancy"
        ),
        housingAffordability: rawValue(row, "social.housingAffordability"),
        publicTrust: rawValue(row, "governance.publicTrust"),
        populationGrowth: rawValue(row, "population.populationGrowth"),
      }))
    );
    const testedCohortReference = adjustedRows.reduce(
      (weighted, row) => {
        const score = rawValue(row, "education.testPerformance");
        const population = regionById.get(String(row._id))?.population;
        if (score === null || !population || population <= 0) return weighted;
        weighted.sum += score * population;
        weighted.population += population;
        return weighted;
      },
      { sum: 0, population: 0 }
    );
    const fertility = rebaseOpeningFertility(
      adjustedRows.map((row) => {
        const regionId = String(row._id);
        return {
          regionId,
          population: regionById.get(regionId)?.population ?? 0,
          legacyBirthRateIndex: rawValue(row, "population.birthRate") ?? Number.NaN,
        };
      }),
      openingNationalTfr[country]
    );
    const fertilityByRegion = new Map(fertility.regions.map((region) => [region.regionId, region]));
    for (const row of adjustedRows) {
      const regionId = String(row._id);
      const population = regionById.get(regionId)?.population;
      const census = getRegionCensusData(country, regionId, "1991-default");
      const age = census?.age;
      const medianAge = rawValue(row, "population.medianAge");
      const rebasedFertility = fertilityByRegion.get(regionId);
      const birthRate = rebasedFertility?.openingBirthRateIndex;
      const cohorts =
        age && population && medianAge !== null && birthRate !== undefined
          ? openingDependencyCohorts(
              synthesizeAgeSexVector({
                adultShares: {
                  young: age.young ?? 0,
                  mid: age.mid ?? 0,
                  mature: age.mature ?? 0,
                  senior: age.senior ?? 0,
                },
                medianAge,
                birthRate,
                population,
              })
            )
          : null;
      const unavailable: string[] = [];
      const openingValues: Record<string, number | null> = {};
      const openingObservations: Record<string, OpeningMetricObservation> = {};
      let observed = 0;
      let provisionalCount = 0;
      for (const metric of regionalMetrics) {
        const owned = buildOpeningMetricObservation(metric.id, {
          legacyValue: rawValue(row, metric.path),
          ownerValue: metric.id === "55" ? rebasedFertility?.openingTfr : null,
          annualCpiChange: inflationByCountry.get(country),
          cpiVolatility48: 0,
          testedCohortScore: rawValue(row, "education.testPerformance"),
          testedCohortReference:
            testedCohortReference.population > 0
              ? testedCohortReference.sum / testedCohortReference.population
              : null,
          legacyTreatmentDelayIndex: delayProxyPath[country]
            ? rawValue(row, delayProxyPath[country])
            : null,
          // Each country's authored seed describes crimeRate as total offenses
          // per 100,000 and violentCrimeRate as the violent subset on that same
          // regional denominator. This reconciles the seed's offense universe;
          // it does not claim the countries' reporting definitions are identical.
          totalCrimeRate: rawValue(row, "publicSafety.crimeRate"),
          violentCrimeRate: rawValue(row, "publicSafety.violentCrimeRate"),
          offenseUniverseReconciled: true,
          populationUnder15: cohorts?.populationUnder15,
          population15To64: cohorts?.population15To64,
          population65Plus: cohorts?.population65Plus,
        });
        const current =
          owned.value === null ? (provisional.get(regionId)?.[metric.id] ?? owned) : owned;
        openingValues[metric.id] = current.value;
        openingObservations[metric.id] = current;
        if (current.value === null) unavailable.push(metric.id);
        else if (current.status === "proxy" && owned.value === null) provisionalCount += 1;
        else observed += 1;
      }
      result.push({
        country,
        regionId,
        observed,
        provisional: provisionalCount,
        unavailable,
        openingValues,
        openingObservations,
      });
    }
  }
  return result;
}
