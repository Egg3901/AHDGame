import type { Db } from "mongodb";
import type { CentralBank, TurnSnapshot } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { State } from "@/lib/db/types/state";
import { gdpWeightedGrowth } from "@/lib/country/nationalGdpGrowth";
import { FOREX_AND_MACRO_CHART_HISTORY_TURNS } from "@/lib/constants/turnTime";

const HISTORY_CAP = FOREX_AND_MACRO_CHART_HISTORY_TURNS;

/**
 * Snapshot interest rate, inflation rate, and GDP growth for all countries
 * that have a central bank document. Called each turn.
 * All three histories are capped at HISTORY_CAP entries (5 in-game years).
 */
export async function snapshotInterestRateHistory(db: Db, turn: number): Promise<void> {
  const banks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  if (banks.length === 0) return;

  // World era: countries without a national metrics doc (layer-1) snapshot the
  // era-authored trend growth instead of a flat hardcoded 2.5 (which recorded
  // min=max=2.5 forever for RU/FR/IT/ES/SE/TR in historical worlds). Keyed on
  // the CURRENT in-game year so the trend graduates as the world advances;
  // absent → modern fallback (fail-safe).
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
  const currentYear = gameState?.currentYear;

  // Pre-collect budget IDs and national doc IDs for batching
  const budgetIdSet = new Set<string>();
  const nationalDocIdSet = new Set<string>();

  for (const bank of banks) {
    const countryId = bank.countryId as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) continue;
    const budgetId = getNationalBudgetId(countryId);
    budgetIdSet.add(budgetId);
    const nationalDocId = getNationalDocId(countryId);
    if (nationalDocId) nationalDocIdSet.add(nationalDocId);
  }

  // Batch-fetch budgets and metrics
  const budgets =
    budgetIdSet.size > 0
      ? await db
          .collection<FederalBudget>("federalBudget")
          .find(
            { _id: { $in: Array.from(budgetIdSet) } },
            { projection: { "economicFactors.inflationRate": 1 } }
          )
          .toArray()
      : [];
  const budgetById = new Map(budgets.map((b) => [b._id.toString(), b]));

  const nationalMetricsDocs =
    nationalDocIdSet.size > 0
      ? await db
          .collection<StateMetrics>("macroMetrics")
          .find(
            { _id: { $in: Array.from(nationalDocIdSet) } },
            { projection: { "economic.gdpGrowth.value": 1 } }
          )
          .toArray()
      : [];
  const metricsById = new Map(nationalMetricsDocs.map((m) => [m._id.toString(), m]));

  // Regional fallback for the countries with no national doc. Only ten
  // countries have one; the rest (FR, IT, ES, SE, TR, GR, AT, FI, the bloc)
  // were snapshotting the era trend constant every turn, so forexTurn and the
  // legitimacy collectors read a flat +4.5 for 240 turns while their regions
  // were live and varying. GDP-weighted mean of the country's regions, the
  // same quantity the national doc caches for the ten that have it.
  const bankCountryIds = banks.map((b) => b.countryId as CountryId);
  const [regionStates, regionMetrics] = await Promise.all([
    db
      .collection<State>("states")
      .find({ countryId: { $in: bankCountryIds } }, { projection: { countryId: 1, gdp: 1 } })
      .toArray(),
    db
      .collection<StateMetrics>("macroMetrics")
      .find(
        { countryId: { $in: bankCountryIds } },
        { projection: { countryId: 1, "economic.gdpGrowth.value": 1 } }
      )
      .toArray(),
  ]);
  const regionGrowthById = new Map(
    regionMetrics.map((m) => [String(m._id), m.economic?.gdpGrowth?.value])
  );
  const regionRowsByCountry = new Map<string, Array<{ growth?: number; gdp: number }>>();
  for (const s of regionStates) {
    const rows = regionRowsByCountry.get(String(s.countryId)) ?? [];
    rows.push({ growth: regionGrowthById.get(String(s._id)), gdp: s.gdp ?? 0 });
    regionRowsByCountry.set(String(s.countryId), rows);
  }

  // `?? fallback` lets NaN through (typeof NaN === "number"). These
  // snapshots feed forexTurn on the next turn, so a single NaN here
  // re-poisons exchangeRates every turn forever — guard all reads.
  const finiteOr = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  const ops = banks.map((bank) => {
    const countryId = bank.countryId as CountryId;

    const budgetId = getNationalBudgetId(countryId);
    const budget = budgetById.get(budgetId);
    const inflationRate = finiteOr(budget?.economicFactors?.inflationRate, 2.5);

    const nationalDocId = getNationalDocId(countryId);
    const nationalMetricsDoc = nationalDocId ? metricsById.get(nationalDocId) : null;
    const nationalGrowth = nationalMetricsDoc?.economic?.gdpGrowth?.value;
    const regionalGrowth = gdpWeightedGrowth(regionRowsByCountry.get(String(countryId)) ?? []);
    const gdpGrowth = finiteOr(
      nationalGrowth,
      finiteOr(regionalGrowth, getEraTrendGdpGrowth(countryId, currentYear) ?? 2.5)
    );

    const ratePoint: TurnSnapshot = { turn, rate: finiteOr(bank.primeRate, 0) };
    const inflationPoint: TurnSnapshot = { turn, rate: inflationRate };
    const gdpPoint: TurnSnapshot = { turn, rate: gdpGrowth };
    const savingsPoint: TurnSnapshot = { turn, rate: finiteOr(bank.currentSavingsPressure, 0) };

    return {
      updateOne: {
        filter: { _id: bank._id },
        update: {
          $push: {
            interestRateHistory: { $each: [ratePoint], $slice: -HISTORY_CAP },
            inflationHistory: { $each: [inflationPoint], $slice: -HISTORY_CAP },
            gdpGrowthHistory: { $each: [gdpPoint], $slice: -HISTORY_CAP },
            savingsFlowHistory: { $each: [savingsPoint], $slice: -HISTORY_CAP },
          },
        },
      },
    };
  });

  await db.collection<CentralBank>("centralBanks").bulkWrite(ops);
}
