import type { Db } from "mongodb";
import type { CountryGameState, ElectedOfficial, GameState, State } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { calendarTurn } from "@/lib/utils/gameDate";
import { ru1993LegislatureStage } from "@/lib/countries/ru/eras/1991";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "@/lib/countries/ru/data/ruPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

/** A ratified post-Soviet constitutional mandate may retire Congress from
 * September 1993 and open the Federal Assembly from January 1994. Raw turn
 * markers keep each enacted step idempotent across worker retries.
 * https://www.prlib.ru/news/2038679
 * https://www.constitution.ru/en/10003000-10.htm
 */
export async function processRuLegislatureTransition(
  db: Db,
  gameState: Pick<GameState, "preset" | "preIteration" | "preIterationTurns">,
  currentTurn: number,
  now: Date
): Promise<"none" | "dissolved" | "federalAssembly"> {
  if (gameState.preset !== "1991-default") return "none";
  const calendar = calendarTurn(currentTurn, {
    preIterationActive: gameState.preIteration?.active,
    preIterationTurns: gameState.preIterationTurns,
  });
  const stage = ru1993LegislatureStage(calendar);
  if (stage === "congress") return "none";

  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruCongressDissolvedSinceTurn: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (!country) return "none";
  if (
    !hasAuthorizedPostSovietTransition(
      currentTurn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return "none";

  if (country.ruCongressDissolvedSinceTurn == null) {
    await db.collection<ElectedOfficial>("electedOfficials").deleteMany({
      countryId: "RU",
      officeType: "congressDeputy",
    });
    await db
      .collection<GovernmentFormation>("governmentFormations")
      .updateOne({ _id: "RU" }, { $set: { totalSeats: 0, majorityThreshold: 1, updatedAt: now } });
    await countries.updateOne(
      { _id: "RU", ruCongressDissolvedSinceTurn: { $exists: false } },
      { $set: { ruCongressDissolvedSinceTurn: currentTurn, updatedAt: now } }
    );
    if (stage !== "federalAssembly") return "dissolved";
  }
  if (stage !== "federalAssembly" || country.ruFederalAssemblySinceTurn != null) return "none";

  // The ten game macroregions are not the 89 federal subjects. Apportion only
  // the Duma's 225 single-member tier by population; the other 225 are list
  // seats and the first 178 Council seats have no subject-level model yet.
  const allocation = apportionSeats(225, RU_1991_ECONOMIC_REGION_POPULATION);
  const regions = await db
    .collection<State>("states")
    .find({ countryId: "RU" }, { projection: { _id: 1 } })
    .toArray();
  if (
    regions.length !== Object.keys(allocation).length ||
    regions.some((region) => allocation[String(region._id)] == null)
  ) {
    return "none";
  }
  await db.collection<State>("states").bulkWrite(
    regions.map((region) => ({
      updateOne: {
        filter: { _id: region._id, countryId: "RU" },
        update: { $set: { houseDistricts: allocation[String(region._id)], stateSenateSeats: 0 } },
      },
    }))
  );
  await db
    .collection<GovernmentFormation>("governmentFormations")
    .updateOne(
      { _id: "RU" },
      { $set: { totalSeats: 450, majorityThreshold: 226, updatedAt: now } }
    );
  await countries.updateOne(
    { _id: "RU", ruFederalAssemblySinceTurn: { $exists: false } },
    { $set: { ruFederalAssemblySinceTurn: currentTurn, updatedAt: now } }
  );
  return "federalAssembly";
}
