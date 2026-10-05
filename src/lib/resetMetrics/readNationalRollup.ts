import type { Db } from "mongodb";
import type { State } from "@/lib/db/types/state";
import { primaryMetrics } from "./catalog";
import { aggregateNationalMetricObservations } from "./rules/nationalAggregation";
import { buildResetMetricSnapshot, type ResetMetricSnapshot } from "./rules/snapshot";
import type { OpeningMetricObservation } from "./rules/openingObservation";

/**
 * Read and validate the regional owner boards used by the national v2 view.
 * The persisted national snapshot remains limited to genuinely national owners.
 */
export async function readNationalMetricRollup(
  db: Db,
  nationalBoard: ResetMetricSnapshot
): Promise<Record<string, OpeningMetricObservation> | null> {
  if (nationalBoard.scope !== "national") return null;
  const [regionalBoards, states] = await Promise.all([
    db
      .collection<ResetMetricSnapshot>("resetMetricSnapshots")
      .find(
        {
          worldId: nationalBoard.worldId,
          countryId: nationalBoard.countryId,
          scope: "regional",
        },
        {
          projection: {
            _id: 1,
            worldId: 1,
            countryId: 1,
            scope: 1,
            regionId: 1,
            sourceTurn: 1,
            asOfTurn: 1,
            observations: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<State>("states")
      .find(
        { countryId: nationalBoard.countryId },
        {
          projection: {
            _id: 1,
            countryId: 1,
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
  if (
    regionalBoards.length === 0 ||
    regionalBoards.length !== states.length ||
    new Set(regionalBoards.map((board) => board.regionId)).size !== regionalBoards.length
  ) {
    return null;
  }

  try {
    const regionalReadings = regionalBoards.map((board) => {
      if (
        board.worldId !== nationalBoard.worldId ||
        board.countryId !== nationalBoard.countryId ||
        board.scope !== "regional" ||
        !board.regionId ||
        board.asOfTurn !== nationalBoard.asOfTurn
      ) {
        throw new Error("National metric rollup encountered a mismatched regional board");
      }
      const validated = buildResetMetricSnapshot({
        worldId: board.worldId,
        countryId: board.countryId,
        regionId: board.regionId,
        sourceTurn: board.sourceTurn,
        observations: board.observations,
      });
      const state = stateById.get(board.regionId);
      if (!state || state.countryId !== nationalBoard.countryId) {
        throw new Error("National metric rollup is missing regional weights");
      }
      return {
        regionId: board.regionId,
        population: state.population,
        workingAgePopulation: state.workingAgePopulation,
        votingEligiblePopulation: state.votingEligiblePopulation,
        gdp: state.gdp,
        observations: validated.observations,
      };
    });
    const regional = aggregateNationalMetricObservations(regionalReadings);
    const combined = { ...regional, ...nationalBoard.observations };
    return Object.keys(combined).length === primaryMetrics.length &&
      primaryMetrics.every((metric) => combined[metric.id])
      ? combined
      : null;
  } catch {
    return null;
  }
}
