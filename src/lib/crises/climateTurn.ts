import type { Db } from "mongodb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { advanceClimateExposure, populationWeightedEmissions } from "./rules/climateFeedback";

export interface ClimateFeedbackState {
  _id: "world";
  pressure: number;
  globalTonsPerCapita: number;
  lastMeasuredTurn: number;
}

interface PopulationRow {
  _id: string;
  population?: number;
  regionType?: string;
}

interface EmissionsRow {
  _id: string;
  environment?: { carbonEmissions?: { value?: number } };
}

/** One global atmosphere, sampled annually so one country cannot change only its own climate. */
export async function processClimateFeedbackTurn(db: Db, turn: number): Promise<number> {
  const collection = db.collection<ClimateFeedbackState>("climateFeedbackState");
  const prior = await collection.findOne({ _id: "world" });
  const oldPressure = prior?.pressure ?? 0;
  if (turn % TURNS_PER_YEAR !== 0 || (prior && prior.lastMeasuredTurn >= turn)) return oldPressure;

  const [regions, metrics] = await Promise.all([
    db
      .collection<PopulationRow>("states")
      .find(
        { regionType: { $nin: ["nation", "constituency"] } },
        {
          projection: { _id: 1, population: 1 },
        }
      )
      .toArray(),
    db
      .collection<EmissionsRow>("stateMetrics")
      .find({}, { projection: { _id: 1, "environment.carbonEmissions.value": 1 } })
      .toArray(),
  ]);
  const populationById = new Map(
    regions
      .filter((region) => !NATIONAL_SCOPE_IDS.has(region._id))
      .map((region) => [region._id, region.population ?? 0])
  );
  const measured = populationWeightedEmissions(
    metrics.map((metric) => ({
      population: populationById.get(metric._id) ?? 0,
      tonsPerCapita: metric.environment?.carbonEmissions?.value ?? Number.NaN,
    }))
  );
  if (measured === null) return oldPressure;

  // Existing saves start measuring now; a new world's first year accrues once.
  const years = prior
    ? Math.max(0, (turn - prior.lastMeasuredTurn) / TURNS_PER_YEAR)
    : turn === TURNS_PER_YEAR
      ? 1
      : 0;
  const next = advanceClimateExposure(oldPressure, measured, years);
  await collection.updateOne(
    { _id: "world" },
    {
      $set: {
        pressure: next.pressure,
        globalTonsPerCapita: next.globalTonsPerCapita,
        lastMeasuredTurn: turn,
      },
    },
    { upsert: true }
  );
  return next.pressure;
}
