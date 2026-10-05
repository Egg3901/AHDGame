import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import { primaryMetricById } from "./catalog";
import type { ResetMetricHistoryPoint } from "./rules/history";
import {
  aggregateNationalMetricHistory,
  aggregateNationalMetricValue,
  type NationalMetricRegionReading,
} from "./rules/nationalAggregation";
import type { ResetMetricSnapshot } from "./rules/snapshot";

export interface ResetMetricDetailRead {
  history: ResetMetricHistoryPoint[];
  nationalValue: number;
  regions: Array<{ regionId: string; name: string; value: number }>;
}

function withCurrentPoint(
  history: readonly ResetMetricHistoryPoint[],
  turn: number,
  value: number
): ResetMetricHistoryPoint[] {
  const next = [...history];
  const last = next.at(-1);
  if (!last || last.turn < turn) next.push({ turn, value });
  else if (last.turn === turn) next[next.length - 1] = { turn, value };
  return next;
}

/** Read-only shell for the dedicated v2 metric drill-down. */
export async function readResetMetricDetail(
  db: Db,
  board: ResetMetricSnapshot,
  metricId: string
): Promise<ResetMetricDetailRead | null> {
  const metric = primaryMetricById(metricId);
  if (!metric) return null;
  const collection = db.collection<ResetMetricSnapshot>("resetMetricSnapshots");
  if (metric.aggregation === "national") {
    const national = await collection.findOne(
      { _id: `${board.countryId}:national`, worldId: board.worldId },
      {
        projection: {
          asOfTurn: 1,
          [`observations.${metricId}`]: 1,
          [`history.${metricId}`]: 1,
        },
      }
    );
    const observation = national?.observations?.[metricId];
    if (
      !national ||
      national.asOfTurn !== board.asOfTurn ||
      !observation ||
      typeof observation.value !== "number" ||
      !Number.isFinite(observation.value)
    ) {
      return null;
    }
    return {
      history: withCurrentPoint(
        national.history?.[metricId] ?? [],
        board.asOfTurn,
        observation.value
      ),
      nationalValue: observation.value,
      regions: [],
    };
  }

  const [regionalBoards, states] = await Promise.all([
    collection
      .find(
        { worldId: board.worldId, countryId: board.countryId, scope: "regional" },
        {
          projection: {
            regionId: 1,
            asOfTurn: 1,
            [`observations.${metricId}`]: 1,
            [`history.${metricId}`]: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<State>("states")
      .find(
        { countryId: board.countryId },
        {
          projection: {
            _id: 1,
            countryId: 1,
            name: 1,
            population: 1,
            workingAgePopulation: 1,
            votingEligiblePopulation: 1,
            gdp: 1,
          },
        }
      )
      .toArray(),
  ]);
  const stateById = new Map(states.map((state) => [String(state._id), state]));
  if (regionalBoards.length === 0 || regionalBoards.length !== states.length) return null;
  try {
    const readings = regionalBoards.map((regional) => {
      const regionId = regional.regionId;
      const state = regionId ? stateById.get(regionId) : undefined;
      const observation = regional.observations?.[metricId];
      const history = regional.history?.[metricId];
      if (
        !regionId ||
        !state ||
        regional.asOfTurn !== board.asOfTurn ||
        !observation ||
        typeof observation.value !== "number" ||
        !Number.isFinite(observation.value) ||
        !history
      ) {
        throw new Error("Incomplete regional metric detail");
      }
      return {
        regionId,
        population: state.population,
        workingAgePopulation: state.workingAgePopulation,
        votingEligiblePopulation: state.votingEligiblePopulation,
        gdp: state.gdp,
        observations: { [metricId]: observation },
        history: { [metricId]: history },
        name: state.name,
        value: observation.value,
      } satisfies NationalMetricRegionReading & {
        history: Record<string, ResetMetricHistoryPoint[]>;
        name: string;
        value: number;
      };
    });
    const nationalValue = aggregateNationalMetricValue(metricId, readings);
    const selectedRegion =
      board.scope === "regional"
        ? readings.find((reading) => reading.regionId === board.regionId)
        : undefined;
    if (board.scope === "regional" && !selectedRegion) return null;
    const displayedHistory = selectedRegion
      ? withCurrentPoint(selectedRegion.history[metricId]!, board.asOfTurn, selectedRegion.value)
      : withCurrentPoint(
          aggregateNationalMetricHistory(metricId, readings),
          board.asOfTurn,
          nationalValue
        );
    return {
      history: displayedHistory,
      nationalValue,
      regions: readings
        .map((reading) => ({
          regionId: reading.regionId,
          name: reading.name,
          value: reading.value,
        }))
        .sort((left, right) => right.value - left.value),
    };
  } catch {
    return null;
  }
}
