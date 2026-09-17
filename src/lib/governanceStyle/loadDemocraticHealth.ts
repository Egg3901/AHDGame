import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { loadDemocraticCompetition } from "./loadCompetition";
import { scoreGovernanceStyle } from "./score";
import { aggregateNationalPoliticalMetrics } from "@/lib/politicalMetrics/aggregate";

type DemocraticHealthGameState =
  Pick<GameState, "preset" | "presidentialTenureByCountry"> | null | undefined;

/**
 * Load the same national Democratic Health score shown by the political
 * metrics screen, without loading the rest of that screen's evidence payload.
 * The election engine consumes this read-only value once per presidential vote
 * turn and applies its own candidate-pressure channel from the snapshot.
 */
export async function loadDemocraticHealth(
  db: Db,
  countryId: CountryId,
  gameState: DemocraticHealthGameState
): Promise<number | null> {
  const [docs, states] = await Promise.all([
    db.collection<PoliticalMetricsDoc>("politicalMetrics").find({ countryId }).toArray(),
    db
      .collection<Pick<State, "_id" | "population">>("states")
      .find({ countryId }, { projection: { _id: 1, population: 1 } })
      .toArray(),
  ]);
  if (docs.length === 0) return null;

  const populationByRegion = new Map(states.map((state) => [state._id, state.population ?? 0]));
  const national = aggregateNationalPoliticalMetrics(docs, populationByRegion);
  const competition = await loadDemocraticCompetition(
    db,
    countryId,
    gameState?.preset,
    gameState ?? null
  );
  return scoreGovernanceStyle(national, competition).democraticHealth.value;
}
