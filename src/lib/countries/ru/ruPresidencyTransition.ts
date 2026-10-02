/**
 * Russia's direct presidency activates after a certified ticket and July eligibility.
 * processRuPresidencyTransition seats that ticket transactionally; a historical
 * date or an unbound certification marker never removes the existing Chairman.
 */
import { ObjectId, type Db } from "mongodb";
import type { GameState } from "@/lib/db/types";
import { calendarTurn } from "@/lib/utils/gameDate";
import { ru1991PresidencyStage } from "@/lib/countries/ru/eras/1991";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { materializeRussianPresidentialSeating } from "./presidentialSeating";
export async function processRuPresidencyTransition(
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
  if (ru1991PresidencyStage(calendar) !== "inaugurated") return false;
  const officialIds: [ObjectId, ObjectId] = [new ObjectId(), new ObjectId()];
  return runRequiredTransaction(
    (session) =>
      materializeRussianPresidentialSeating({ db, session, turn: currentTurn, now, officialIds }),
    { client: db.client }
  );
}
