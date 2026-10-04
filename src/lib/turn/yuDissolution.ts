import type { Db } from "mongodb";
import type { CountryGameState, ElectedOfficial, Election, GameState } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { calendarTurn } from "@/lib/utils/gameDate";
import {
  yuDissolutionDue,
  yuPoliticalRetirementAuthorized,
} from "@/lib/countries/yu/rules/succession";

/**
 * Retire SFRY federal institutions after the historical decision window opens
 * and a ratified settlement has actually materialized successor countries.
 * Every write before dissolvedTurn is idempotent, so a failed attempt resumes
 * on the next turn. Region records remain intact as historical source data;
 * allocating them to sovereign republics and activating FRY is a separate
 * migration and must not be inferred from a simple country rename.
 */
export async function processYuDissolution(
  db: Db,
  gameState: Pick<GameState, "preset" | "preIteration" | "preIterationTurns">,
  currentTurn: number,
  now: Date
): Promise<boolean> {
  const due = yuDissolutionDue(
    gameState.preset,
    calendarTurn(currentTurn, {
      preIterationActive: gameState.preIteration?.active,
      preIterationTurns: gameState.preIterationTurns,
    })
  );
  if (!due) return false;

  const countries = db.collection<CountryGameState>("countryGameStates");
  const yu = await countries.findOne(
    { _id: "YU" },
    {
      projection: {
        yuSuccessionMandateSinceTurn: 1,
        yuSettlementAppliedSinceTurn: 1,
        dissolvedTurn: 1,
      },
    }
  );
  if (!yu || yu.dissolvedTurn != null) return false;
  if (
    !yuPoliticalRetirementAuthorized(
      currentTurn,
      yu.yuSuccessionMandateSinceTurn,
      yu.yuSettlementAppliedSinceTurn
    )
  )
    return false;

  await db
    .collection<Election>("elections")
    .updateMany(
      { countryId: "YU", status: { $in: ["upcoming", "active", "completed"] } },
      { $set: { status: "cancelled", updatedAt: now } }
    );
  await db.collection<ElectedOfficial>("electedOfficials").deleteMany({ countryId: "YU" });
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "YU" },
    {
      $set: {
        status: "collapsed",
        collapsedAt: now,
        pmCharacterId: null,
        pmNppId: null,
        pmName: null,
        updatedAt: now,
      },
    }
  );
  await countries.updateOne(
    { _id: "YU", dissolvedTurn: null },
    { $set: { dissolvedTurn: currentTurn, updatedAt: now } }
  );
  return true;
}
