import type { Db } from "mongodb";
import type { FederalBudget, State } from "@/lib/db/types";
import type { CountryState } from "@/lib/db/types/countryState";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getAllCountryAccess } from "@/lib/countryAccess";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { liveNationalGdpUnits, resolveRatioGdp } from "@/lib/budget/gdpDenominator";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function queryCountries(db: Db) {
  const accessByCountry = await getAllCountryAccess(db);
  const countryIds = Object.keys(accessByCountry) as CountryId[];
  const [states, runtimeStates] = await Promise.all([
    db
      .collection<State>("states")
      .find(
        { countryId: { $in: countryIds } },
        { projection: { countryId: 1, population: 1, gdp: 1 } }
      )
      .toArray(),
    db
      .collection<CountryState>("countryState")
      .find({ _id: { $in: countryIds } }, { projection: { _id: 1, governmentType: 1 } })
      .toArray(),
  ]);

  const totals = new Map<CountryId, { population: number; gdpMillions: number; regions: number }>();
  for (const state of states) {
    const current = totals.get(state.countryId) ?? { population: 0, gdpMillions: 0, regions: 0 };
    current.population += finiteOrNull(state.population) ?? 0;
    current.gdpMillions += finiteOrNull(state.gdp) ?? 0;
    current.regions += 1;
    totals.set(state.countryId, current);
  }
  const runtimeByCountry = new Map(runtimeStates.map((state) => [state._id, state]));
  const configuredOrder = new Map(COUNTRY_ORDER.map((id, index) => [id, index]));

  return {
    found: countryIds.length > 0,
    countries: countryIds
      .sort(
        (a, b) =>
          (configuredOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (configuredOrder.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b)
      )
      .map((countryId) => {
        const config = COUNTRY_CONFIGS[countryId];
        const access = accessByCountry[countryId];
        const total = totals.get(countryId);
        return {
          id: countryId,
          name: config.name,
          governmentType: runtimeByCountry.get(countryId)?.governmentType ?? config.governmentType,
          status: access.status,
          enabledForPlayers: access.enabledForPlayers,
          economyPreview: access.economyPreview,
          currencyCode: COUNTRY_CURRENCY_MAP[countryId] ?? null,
          regionCount: total?.regions ?? 0,
          population: total?.population ?? null,
          gdpMillions: total?.gdpMillions ?? null,
        };
      }),
  };
}

export async function queryCountryRegions(db: Db, country: string) {
  const countryId = country.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return null;

  const states = await db
    .collection<State>("states")
    .find({ countryId })
    .sort({ name: 1 })
    .toArray();

  const regions = states.map((state) => {
    const population = finiteOrNull(state.population);
    const gdpMillions = finiteOrNull(state.gdp);
    return {
      id: state._id,
      countryId,
      name: state.name,
      regionType: state.regionType ?? "state",
      parentRegionId: state.parentRegionId ?? null,
      region: state.region ?? null,
      population,
      votingEligiblePopulation: finiteOrNull(state.votingEligiblePopulation),
      workingAgePopulation: finiteOrNull(state.workingAgePopulation),
      gdpMillions,
      gdpPerCapita:
        population && gdpMillions != null
          ? Math.round((gdpMillions * 1_000_000) / population)
          : null,
      houseDistricts: finiteOrNull(state.houseDistricts),
      stateSenateSeats: finiteOrNull(state.stateSenateSeats),
      votingSystem: state.votingSystem ?? "fptp",
      economicLean: finiteOrNull(state.cachedEconomicLean),
      socialLean: finiteOrNull(state.cachedSocialLean),
      sectorSpecializations: state.sectorSpecializations
        ? {
            primary: state.sectorSpecializations.primary,
            secondary: state.sectorSpecializations.secondary,
          }
        : null,
      topSectors:
        state.topSectorsCache?.sectors.map((sector) => ({
          type: sector.sectorType,
          revenue: sector.revenue,
          specializationBonus: sector.specializationBonus,
        })) ?? [],
      metricsUpdatedAt: state.demographicsLastUpdated?.toISOString() ?? null,
    };
  });

  return {
    found: regions.length > 0,
    countryId,
    countryName: COUNTRY_CONFIGS[countryId].name,
    count: regions.length,
    regions,
  };
}

export async function queryCountryBudget(db: Db, country: string) {
  const countryId = country.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) return null;

  const [budget, states] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({
      _id: getNationalBudgetId(countryId),
    }),
    db
      .collection<Pick<State, "gdp">>("states")
      .find({ countryId }, { projection: { gdp: 1 } })
      .toArray(),
  ]);
  if (!budget) return { found: false, countryId };

  const gdp = liveNationalGdpUnits(states);
  const ratioGdp = resolveRatioGdp(budget);
  const balance = federalSurplus(budget);
  const currencyCode = resolveCountryCurrencyCode(budget) ?? COUNTRY_CURRENCY_MAP[countryId];

  return {
    found: true,
    countryId,
    countryName: COUNTRY_CONFIGS[countryId].name,
    fiscalYear: budget.fiscalYear,
    currencyCode,
    gdp: gdp > 0 ? gdp : finiteOrNull(budget.gdp),
    gdpSmoothed: finiteOrNull(budget.gdpSmoothed),
    revenue: {
      total: finiteOrNull(budget.revenue?.total),
      bySource: budget.revenue ? { ...budget.revenue } : {},
    },
    spending: {
      total: finiteOrNull(budget.spending?.total),
      byCategory: budget.spending?.byCategory ?? {},
      stateGrants: finiteOrNull(budget.spending?.stateGrants),
      debtInterest: finiteOrNull(budget.spending?.debtInterest),
    },
    balance,
    balancePctGdp: ratioGdp > 0 ? Math.round((balance / ratioGdp) * 10_000) / 100 : null,
    treasuryBalance: finiteOrNull(budget.treasuryBalance),
    debt: {
      principal: finiteOrNull(budget.debt?.principal),
      interestRate: finiteOrNull(budget.debt?.interestRate),
      ceiling: finiteOrNull(budget.debt?.ceiling),
      debtToGdpRatio: finiteOrNull(budget.debtToGdpRatio),
      creditRating: budget.creditRating ?? null,
      crisisState: budget.sovereignCrisisState ?? "normal",
    },
    taxRates: budget.taxRates ?? {},
    economicIndicators: {
      inflation: finiteOrNull(budget.economicFactors?.inflationRate),
      gdpGrowth: finiteOrNull(budget.economicFactors?.gdpGrowth),
      wageGrowth: finiteOrNull(budget.economicFactors?.wageGrowth),
      tradeGrowth: finiteOrNull(budget.economicFactors?.tradeGrowth),
      investorConfidence: finiteOrNull(budget.investorConfidence),
    },
    updatedAt: budget.updatedAt?.toISOString() ?? null,
  };
}
