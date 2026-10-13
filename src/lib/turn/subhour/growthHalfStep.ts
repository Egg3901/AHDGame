import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { FederalBudget } from "@/lib/db/types/budget";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { NATIONAL_SCOPE, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { compoundGdpLevel } from "@/lib/metricEngine/gdpLevel";
import { gdpWeightedGrowth, resolvePipelineGdpGrowth } from "@/lib/country/nationalGdpGrowth";
import { getRegisteredCountryIdSet } from "@/lib/country/registeredCountries";
import {
  HALF_TICK_FRACTION,
  hasSubhourStep,
  subhourStepStamp,
  type SubhourStepStamp,
} from "./stepFraction";
import {
  activeSubhourBase,
  type SubhourGrowthMetricBase,
  type SubhourGrowthStateBase,
} from "./stepBase";

type GrowthState = Pick<State, "_id" | "countryId" | "gdp" | "outputGap" | "subhourStep"> & {
  subhourBase?: State["subhourBase"];
};

interface GrowthMetrics {
  _id: string;
  subhourStep?: StateMetrics["subhourStep"];
  subhourBase?: StateMetrics["subhourBase"];
  economic?: {
    gdpGrowth?: { value?: number };
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** National rollups round to three decimals (see computeNationalMetrics). */
function roundNational(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The half step for one region, from the values the last turn settled.
 *
 * Headline growth is the measured real output growth (metricEngine/
 * outputTrend.ts); its sector signal and the output trend only refresh on the
 * turn, so the half step reports the same annualized growth, leaves the output
 * gap where the turn put it, and compounds the GDP level by exactly the square
 * root of the hour's factor (TURNS_PER_YEAR / fraction steps a year).
 */
export function growthHalfStepForRegion(
  input: { gdp: number; outputGap: number; gdpGrowth: number },
  fraction = HALF_TICK_FRACTION
): { gdp: number; outputGap: number; gdpGrowth: number } {
  const turnsPerStep = TURNS_PER_YEAR / fraction;
  return {
    gdp: compoundGdpLevel(input.gdp, input.gdpGrowth, turnsPerStep),
    outputGap: input.outputGap,
    gdpGrowth: input.gdpGrowth,
  };
}

/**
 * :30 half step for growth. See stepFraction.ts for the contract and
 * stepBase.ts for how the turn completes the hour.
 *
 * Moves each region's GDP level and output gap half a turn, sets its displayed
 * growth rate to that half step's rate, and refreshes the national rollup and
 * the budget's growth figure from them so the headline numbers move. Nothing
 * else in the metric engine runs (capital stock, conflict capacity, sector EMA,
 * every other node stay hourly), no history is appended, and tax bases keep
 * growing once per turn.
 */
export async function runGrowthHalfStep(
  db: Db,
  turn: number,
  _now: Date
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const fraction = HALF_TICK_FRACTION;
  const stamp = subhourStepStamp(turn, fraction);

  const [states, metrics, budgets, liveCountries] = await Promise.all([
    db
      .collection<State>("states")
      .find({})
      .project<GrowthState>({
        countryId: 1,
        gdp: 1,
        outputGap: 1,
        subhourStep: 1,
        subhourBase: 1,
      })
      .toArray(),
    db
      .collection<StateMetrics>("macroMetrics")
      .find({})
      .project<GrowthMetrics>({
        "economic.gdpGrowth.value": 1,
        subhourStep: 1,
        subhourBase: 1,
      })
      .toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find({})
      .project<Pick<FederalBudget, "_id" | "countryId" | "economicFactors" | "subhourStep">>({
        countryId: 1,
        "economicFactors.gdpGrowth": 1,
        subhourStep: 1,
      })
      .toArray(),
    getRegisteredCountryIdSet(db),
  ]);
  const metricsById = new Map(metrics.map((m) => [String(m._id), m]));

  const stateOps: AnyBulkWriteOperation<State>[] = [];
  const metricOps: AnyBulkWriteOperation<StateMetrics>[] = [];
  // Region rows after the step, per country, for the national rollups.
  const regionsByCountry = new Map<string, Array<{ growth?: number; gdp: number }>>();
  let alreadyStepped = 0;

  for (const state of states) {
    if (NATIONAL_SCOPE_IDS.has(String(state._id))) continue;
    const metric = metricsById.get(String(state._id));
    let gdp = state.gdp ?? 0;
    let growth = metric?.economic?.gdpGrowth?.value;
    const rows = regionsByCountry.get(state.countryId) ?? [];
    regionsByCountry.set(state.countryId, rows);

    const done = activeSubhourBase(state.subhourStep, state.subhourBase?.growth, turn);
    if (done) {
      alreadyStepped++;
    } else if (finite(gdp) && gdp > 0 && finite(growth)) {
      const outputGap = finite(state.outputGap) ? state.outputGap : 0;
      const next = growthHalfStepForRegion({ gdp, outputGap, gdpGrowth: growth }, fraction);
      const stateBase: SubhourGrowthStateBase = {
        turn,
        gdp: { base: gdp, written: next.gdp },
        outputGap: { base: outputGap, written: next.outputGap },
      };
      const metricBase: SubhourGrowthMetricBase = {
        turn,
        gdpGrowth: { base: growth, written: next.gdpGrowth },
      };
      stateOps.push({
        updateOne: {
          filter: { _id: state._id },
          update: {
            $set: {
              gdp: next.gdp,
              outputGap: next.outputGap,
              subhourStep: stamp,
              "subhourBase.growth": stateBase,
            },
          },
        },
      });
      metricOps.push({
        updateOne: {
          filter: { _id: String(state._id) },
          update: {
            $set: {
              "economic.gdpGrowth.value": next.gdpGrowth,
              subhourStep: stamp,
              "subhourBase.growth": metricBase,
            } as never,
          },
        },
      });
      gdp = next.gdp;
      growth = next.gdpGrowth;
    }
    rows.push({ growth, gdp });
  }

  // National docs are rollups of their regions. They carry start values too:
  // turn phases that run before the national rollup read them, and the turn
  // rewinds every stamped field before it starts (rewindHalfTick.ts).
  // A retried tick must keep the first run's start value, never record its
  // own half-way value as the start.
  const growthBase = (
    doc: { subhourStep?: SubhourStepStamp } | undefined,
    base: unknown,
    written: number
  ) =>
    finite(base) && !hasSubhourStep(doc?.subhourStep, turn)
      ? { "subhourBase.growth": { turn, gdpGrowth: { base, written } } }
      : {};
  const nationalGrowth = new Map<string, number>();
  for (const [nationalId, countryId] of Object.entries(NATIONAL_SCOPE)) {
    if (!metricsById.has(nationalId)) continue;
    const weighted = gdpWeightedGrowth(regionsByCountry.get(countryId) ?? []);
    if (weighted === null) continue;
    const value = roundNational(weighted);
    nationalGrowth.set(countryId, value);
    metricOps.push({
      updateOne: {
        filter: { _id: nationalId },
        update: {
          $set: {
            "economic.gdpGrowth.value": value,
            subhourStep: stamp,
            ...growthBase(
              metricsById.get(nationalId),
              metricsById.get(nationalId)?.economic?.gdpGrowth?.value,
              value
            ),
          } as never,
        },
      },
    });
  }

  // The budget's growth figure, by the same rule the turn's fiscal base growth
  // writes it. That phase overwrites it from the national doc every turn.
  const budgetOps: AnyBulkWriteOperation<FederalBudget>[] = [];
  for (const budget of budgets) {
    if (!liveCountries.has(String(budget.countryId ?? budget._id))) continue;
    const countryId =
      budget.countryId || (String(budget._id) === "federal" ? "US" : String(budget._id));
    const regions = regionsByCountry.get(countryId);
    if (!regions || regions.length === 0) continue;
    const gdpGrowth = resolvePipelineGdpGrowth({
      nationalDocGrowth: nationalGrowth.get(countryId),
      regions,
    });
    budgetOps.push({
      updateOne: {
        filter: { _id: budget._id },
        update: {
          $set: {
            "economicFactors.gdpGrowth": gdpGrowth,
            subhourStep: stamp,
            ...growthBase(budget, budget.economicFactors?.gdpGrowth, gdpGrowth),
          },
        },
      },
    });
  }

  // Region stocks first: each state doc holds the start values the turn needs,
  // so a failure after this write leaves only display fields behind.
  if (stateOps.length > 0) await db.collection<State>("states").bulkWrite(stateOps);
  if (metricOps.length > 0)
    await db.collection<StateMetrics>("macroMetrics").bulkWrite(metricOps, { ordered: false });
  if (budgetOps.length > 0)
    await db.collection<FederalBudget>("federalBudget").bulkWrite(budgetOps, { ordered: false });

  return {
    regions: stateOps.length,
    nationals: nationalGrowth.size,
    budgets: budgetOps.length,
    alreadyStepped,
    ms: Date.now() - started,
  };
}
