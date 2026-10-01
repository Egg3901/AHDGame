/**
 * Russia replaces Congress only after both certified Assembly chambers can serve.
 * processRuLegislatureTransition seats the receipt-backed replacement atomically;
 * dates, mandates and legacy certification markers never vacate Congress alone.
 */
import type { Db } from "mongodb";
import type { GameState, CountryGameState } from "@/lib/db/types";
import { calendarTurn } from "@/lib/utils/gameDate";
import { ru1993LegislatureStage } from "./eras/1991";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
import { materializeRussianAssemblySeating } from "./assemblySeating";
export async function processRuLegislatureTransition(
  db: Db,
  gameState: Pick<GameState, "preset" | "preIteration" | "preIterationTurns">,
  currentTurn: number,
  now: Date
): Promise<"none" | "dissolved" | "federalAssembly"> {
  if (
    gameState.preset !== "1991-default" ||
    ru1993LegislatureStage(
      calendarTurn(currentTurn, {
        preIterationActive: gameState.preIteration?.active,
        preIterationTurns: gameState.preIterationTurns,
      })
    ) !== "federalAssembly"
  )
    return "none";
  const country = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      projection: {
        ruFirstDumaElectionCohortId: 1,
        ruFirstCouncilElectionCohortId: 1,
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (
    !country?.ruFirstDumaElectionCohortId ||
    !country.ruFirstCouncilElectionCohortId ||
    country.ruFederalAssemblySinceTurn != null ||
    !hasAuthorizedPostSovietTransition(
      currentTurn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return "none";
  const seated = await runRequiredTransaction(
    (session) => materializeRussianAssemblySeating({ db, session, turn: currentTurn, now }),
    { client: db.client }
  );
  return seated ? "federalAssembly" : "none";
}
