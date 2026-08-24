/**
 * National Economic Outlook payload (`GET /api/country/[code]/economy`).
 *
 * Read-path aggregation only — every number already exists somewhere
 * (central bank ring buffers, the live federal budget, state metrics, the
 * stock-exchange snapshot, exchange rates, sector pools). Decisions locked
 * in the design: the central-bank figure is the hero GDP growth; the
 * state-weighted metrics values appear as detail rows labeled as such; the
 * outlook verdict is derived client-side, nothing stored.
 */

import type { Db } from "mongodb";
import type {
  CentralBank,
  GameConfig,
  State,
  StockExchangeSnapshot,
  ExchangeRate,
  TurnSnapshot,
} from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { getGameState } from "@/lib/gameState";
import { getInflationTarget, getNeutralPrimeRate } from "@/lib/budget/inflation";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { aggregateNationalGdp } from "@/lib/utils/nationalGdp";
import { aggregateCountrySectorMix, type CountrySectorMixEntry } from "@/lib/economy/sectorMix";
import {
  concentrationStatus,
  type ConcentrationStatus,
} from "@/lib/nationalization/concentrationStatus";
import { clampConcentration } from "@/lib/nationalization/concentration";
import {
  presentPlannedEconomy,
  type PlannedEconomyView,
} from "@/lib/economy/presentPlannedEconomy";
import {
  householdPriceAdjustedValue,
  HOUSEHOLD_PRICE_INDEX_BASELINE,
} from "@/lib/economy/householdPriceIndex";

interface HistoryPoint {
  turn: number;
  rate: number;
}

export interface CountryEconomyOutlook {
  countryId: CountryId;
  currencyCode: string;
  currentTurn: number;
  pulse: {
    /** National GDP, local-currency millions (sum of regional GDP). */
    gdpMillions: number;
    /** GDP per capita, base local-currency units. */
    gdpPerCapita: number;
    /** Hero figure — the central bank's national GDP growth. */
    gdpGrowth: { value: number | null; history: HistoryPoint[] };
    inflation: { value: number | null; target: number; history: HistoryPoint[] };
    primeRate: {
      value: number | null;
      /** Turns since the chair last moved the rate; null when never moved. */
      heldTurns: number | null;
      /** Per-country neutral prime rate (policy neither stimulative nor restrictive). */
      neutral: number;
      history: HistoryPoint[];
    };
    credit: { rating: string | null; debtToGdpRatio: number | null };
  };
  realEconomy: {
    wageGrowth: number | null;
    tradeGrowth: number | null;
    /** Country household price level, where 1 = reset-price baseline. */
    householdPriceIndex: number;
    /** State/province-weighted national metric (not the central-bank figure). */
    unemployment: { value: number | null; trend: number | null };
    medianIncome: { value: number | null; trend: number | null };
    /** Median income in reset-price purchasing power. */
    realMedianIncome: number | null;
    /** Total national population (sum of region populations). */
    population: number | null;
  };
  markets: {
    chairName: string | null;
    stockMarketCap: number | null;
    exchangeName: string | null;
    /** Local currency per ₳1 (the Forex page's own convention). */
    forexRate: number | null;
    /** Live budget surplus (negative = deficit), local currency. */
    surplus: number | null;
    deficitToGdp: number | null;
  };
  sectorMix: CountrySectorMixEntry[];
  /** State Ownership Concentration Index (SOCI, 0–100) + presentation status. */
  stateOwnership: {
    concentration: number;
    status: ConcentrationStatus;
  };
  /**
   * Command / dual-track shortage-economy readouts. Null for market economies
   * and when the feature flag is off with no persisted fields (byte-identical UI).
   */
  plannedEconomy: PlannedEconomyView | null;
  /** Calendar year used for marketization / regime banding. */
  currentYear: number | null;
  /** GameConfig.commandEconomyEnabled — surface for client-side gates. */
  commandEconomyEnabled: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function mapHistory(history: TurnSnapshot[] | undefined): HistoryPoint[] {
  return (history ?? []).map((s) => ({ turn: s.turn, rate: s.rate }));
}

/** Pop-weighted average of one state metric (value + trend), null-safe. */
function popWeighted(
  metrics: Array<{ _id: string; value?: number; trend?: number }>,
  populationByStateId: Map<string, number>
): { value: number | null; trend: number | null } {
  let valueSum = 0;
  let trendSum = 0;
  let population = 0;
  for (const m of metrics) {
    if (typeof m.value !== "number") continue;
    const pop = populationByStateId.get(m._id) ?? 0;
    valueSum += m.value * pop;
    trendSum += (typeof m.trend === "number" ? m.trend : 0) * pop;
    population += pop;
  }
  if (population <= 0) return { value: null, trend: null };
  return { value: round2(valueSum / population), trend: round2(trendSum / population) };
}

export async function buildCountryEconomyOutlook(
  db: Db,
  countryId: CountryId
): Promise<CountryEconomyOutlook> {
  const exchangeApiKey = getExchangeApiKey(countryId);
  const { bankId } = await getCentralBankScope(db, countryId);

  const [bank, budget, states, gameState, exchangeRate, snapshot, sectorMix, gameConfig] =
    await Promise.all([
      db.collection<CentralBank>("centralBanks").findOne({ _id: bankId }),
      db
        .collection<FederalBudget>("federalBudget")
        .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }),
      db
        .collection<State>("states")
        .find({ countryId })
        .project<Pick<State, "_id" | "name" | "gdp" | "population">>({
          name: 1,
          gdp: 1,
          population: 1,
        })
        .toArray(),
      getGameState(db),
      db.collection<ExchangeRate>("exchangeRates").findOne({ _id: countryId }),
      exchangeApiKey
        ? db
            .collection<StockExchangeSnapshot>("stockExchangeSnapshots")
            .findOne({ _id: exchangeApiKey })
        : Promise.resolve(null),
      aggregateCountrySectorMix(db, countryId),
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    ]);

  const stateMetrics = await db
    .collection<StateMetrics>("macroMetrics")
    .find({ _id: { $in: states.map((s) => s._id) } })
    .project<{
      _id: string;
      economic?: {
        unemploymentRate?: { value?: number; trend?: number };
        medianIncome?: { value?: number; trend?: number };
      };
    }>({ "economic.unemploymentRate": 1, "economic.medianIncome": 1 })
    .toArray();

  const currentTurn = gameState?.currentTurn ?? 0;
  const currentYear = gameState?.currentYear ?? null;
  const commandEconomyEnabled = gameConfig?.commandEconomyEnabled === true;
  const plannedEconomy = presentPlannedEconomy(
    countryId,
    currentYear,
    commandEconomyEnabled,
    budget?.economicFactors
  );
  const gdp = aggregateNationalGdp(states);
  const populationByStateId = new Map(states.map((s) => [s._id, s.population ?? 0]));
  const medianIncome = popWeighted(
    stateMetrics.map((m) => ({
      _id: m._id,
      value: m.economic?.medianIncome?.value,
      trend: m.economic?.medianIncome?.trend,
    })),
    populationByStateId
  );
  const persistedHouseholdPriceIndex = budget?.economicFactors?.householdPriceIndex;
  const householdPriceIndex =
    typeof persistedHouseholdPriceIndex === "number" &&
    Number.isFinite(persistedHouseholdPriceIndex) &&
    persistedHouseholdPriceIndex > 0
      ? persistedHouseholdPriceIndex
      : HOUSEHOLD_PRICE_INDEX_BASELINE;

  const gdpGrowthHistory = mapHistory(bank?.gdpGrowthHistory);
  const inflationHistory = mapHistory(bank?.inflationHistory);
  const primeRateHistory = mapHistory(bank?.interestRateHistory);

  const listings = snapshot?.listings ?? [];
  const stockMarketCap = snapshot ? listings.reduce((sum, l) => sum + (l.marketCap ?? 0), 0) : null;

  // Derived, not read: `budget.surplus` is a cache that drifts intra-year, and
  // `federalBudgetDetail` already recomputes the same expression for the Budget
  // page. See lib/budget/federalSurplus.
  const surplus = budget ? federalSurplus(budget) : null;
  const budgetGdp = budget?.gdp ?? null;

  return {
    countryId,
    currencyCode: COUNTRY_CONFIGS[countryId].currencyCode,
    currentTurn,
    pulse: {
      gdpMillions: gdp.gdpMillions,
      gdpPerCapita: round2(gdp.perCapita),
      gdpGrowth: {
        value: gdpGrowthHistory.at(-1)?.rate ?? null,
        history: gdpGrowthHistory,
      },
      inflation: {
        value: budget?.economicFactors?.inflationRate ?? inflationHistory.at(-1)?.rate ?? null,
        target: getInflationTarget(countryId, gameState?.currentYear),
        history: inflationHistory,
      },
      primeRate: {
        value: bank?.primeRate ?? null,
        heldTurns:
          bank?.lastRateChangeTurn != null
            ? Math.max(0, currentTurn - bank.lastRateChangeTurn)
            : null,
        neutral: getNeutralPrimeRate(countryId, gameState?.currentYear),
        history: primeRateHistory,
      },
      credit: {
        rating: budget?.creditRating ?? null,
        debtToGdpRatio: budget?.debtToGdpRatio ?? null,
      },
    },
    realEconomy: {
      wageGrowth: budget?.economicFactors?.wageGrowth ?? null,
      tradeGrowth: budget?.economicFactors?.tradeGrowth ?? null,
      householdPriceIndex,
      unemployment: popWeighted(
        stateMetrics.map((m) => ({
          _id: m._id,
          value: m.economic?.unemploymentRate?.value,
          trend: m.economic?.unemploymentRate?.trend,
        })),
        populationByStateId
      ),
      medianIncome,
      realMedianIncome: householdPriceAdjustedValue(medianIncome.value, householdPriceIndex),
      // SP6: the Economy page is the statistics home — total population joins
      // the real-economy rows.
      population: states.reduce((sum, s) => sum + (s.population ?? 0), 0),
    },
    markets: {
      chairName: bank?.chairCharacterName ?? null,
      stockMarketCap,
      exchangeName: snapshot?.exchangeName ?? COUNTRY_CONFIGS[countryId].exchangeName ?? null,
      forexRate: exchangeRate?.rate ?? null,
      surplus,
      deficitToGdp:
        surplus != null && budgetGdp != null && budgetGdp > 0
          ? round2((surplus / budgetGdp) * 100)
          : null,
    },
    sectorMix,
    stateOwnership: {
      concentration: clampConcentration(budget?.stateOwnershipConcentration ?? 0),
      status: concentrationStatus(budget?.stateOwnershipConcentration ?? 0),
    },
    plannedEconomy,
    currentYear,
    commandEconomyEnabled,
  };
}
