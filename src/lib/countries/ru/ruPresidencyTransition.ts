import type { Db } from "mongodb";
import type { CountryGameState, ElectedOfficial, GameState } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { calendarTurn } from "@/lib/utils/gameDate";
import { ru1991PresidencyStage } from "@/lib/countries/ru/eras/1991";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

/** The first direct Russian presidential election took place on June 12, 1991.
 * That date opens eligibility; only a ratified Soviet succession and a separate
 * constitutional mandate create this office in the alternate-history campaign.
 * https://www.prlib.ru/section/2121879
 * https://www.prlib.ru/node/405940
 */
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

  const states = db.collection<CountryGameState>("countryGameStates");
  const ru = await states.findOne(
    { _id: "RU" },
    {
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruPresidencyMandateSinceTurn: 1,
        ruPresidencySinceTurn: 1,
      },
    }
  );
  if (!ru || ru.ruPresidencySinceTurn != null) return false;
  if (
    !hasAuthorizedPostSovietTransition(
      currentTurn,
      ru.ruSovietSuccessionSinceTurn,
      ru.ruPresidencyMandateSinceTurn
    )
  )
    return false;

  // The Chairman's head-of-state mandate ends. Keep Congress and its prime
  // minister intact; the 1993 dissolution is a separate transition. The
  // presidential winner remains pending until a national vote resolver exists.
  await db.collection<ElectedOfficial>("electedOfficials").deleteMany({
    countryId: "RU",
    officeType: "chairmanOfSupremeSoviet",
  });
  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "RU" },
    {
      $set: {
        hosCharacterId: null,
        hosNppId: null,
        hosName: null,
        updatedAt: now,
      },
    }
  );
  await db
    .collection("pmAppointmentVotes")
    .updateMany(
      { countryId: "RU", office: "headOfState", status: "active" },
      { $set: { status: "cancelled", closedAt: now, updatedAt: now } }
    );
  await states.updateOne(
    { _id: "RU", ruPresidencySinceTurn: { $exists: false } },
    { $set: { ruPresidencySinceTurn: currentTurn, updatedAt: now } }
  );
  return true;
}
