import type { Db } from "mongodb";
import type { CountryGameState, Election, GameState, State } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  BG_ORDINARY_ASSEMBLY_SEATS,
  BG_ORDINARY_ASSEMBLY_TOTAL_SEATS,
  canOpenBgOrdinaryAssembly,
} from "@/lib/countries/bg/rules/assemblyTransition";

/**
 * Replace Bulgaria's 1990 constituent chamber after every region has resolved
 * the October 1991 ordinary Assembly election and the game calendar reaches
 * November. The marker is written last, so a crash between seat writes and
 * the marker replays the same seat values on the next turn.
 */
export async function processBgAssemblyTransition(
  db: Db,
  gameState: Pick<GameState, "preset" | "preIteration" | "preIterationTurns">,
  currentTurn: number,
  now: Date
): Promise<boolean> {
  if (gameState.preset !== "1991-default") return false;

  const calendar = calendarTurn(currentTurn, {
    preIterationActive: gameState.preIteration?.active,
    preIterationTurns: gameState.preIterationTurns,
  });
  const countryStates = db.collection<CountryGameState>("countryGameStates");
  const country = await countryStates.findOne(
    { _id: "BG" },
    { projection: { bgOrdinaryAssemblySinceTurn: 1 } }
  );
  if (!country || country.bgOrdinaryAssemblySinceTurn != null) return false;

  const regions = await db
    .collection<State>("states")
    .find({ countryId: "BG" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = regions.map((region) => String(region._id));
  if (
    regionIds.length !== Object.keys(BG_ORDINARY_ASSEMBLY_SEATS).length ||
    regionIds.some((id) => BG_ORDINARY_ASSEMBLY_SEATS[id] == null)
  ) {
    return false;
  }

  const resolved = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "BG",
        electionType: "nationalAssembly",
        cycle: 1,
        status: "resolved",
      },
      { projection: { state: 1, totalSeats: 1 } }
    )
    .toArray();
  const resolvedSeats = Object.fromEntries(
    resolved.map((election) => [election.state, election.totalSeats ?? 0])
  );
  if (resolved.length !== regionIds.length || !canOpenBgOrdinaryAssembly(calendar, resolvedSeats)) {
    return false;
  }

  await db.collection<State>("states").bulkWrite(
    regionIds.map((id) => ({
      updateOne: {
        filter: { _id: id, countryId: "BG" },
        update: { $set: { houseDistricts: BG_ORDINARY_ASSEMBLY_SEATS[id] } },
      },
    }))
  );
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "BG" },
    {
      $set: {
        totalSeats: BG_ORDINARY_ASSEMBLY_TOTAL_SEATS,
        majorityThreshold: Math.floor(BG_ORDINARY_ASSEMBLY_TOTAL_SEATS / 2) + 1,
        updatedAt: now,
      },
    }
  );
  await countryStates.updateOne(
    { _id: "BG", bgOrdinaryAssemblySinceTurn: { $exists: false } },
    { $set: { bgOrdinaryAssemblySinceTurn: currentTurn, updatedAt: now } }
  );
  return true;
}
