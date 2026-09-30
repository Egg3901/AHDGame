/**
 * Parliamentary votes use the world's active offices, including the Soviet
 * Union, a ratified Russian successor and elected Russian constitutional
 * replacements. loadRuntimeCountryOffices reads only the required markers.
 */
import type { Db, ClientSession } from "mongodb";
import { getCountryConfigForRuntime, type CountryId } from "@/lib/constants/countries";
import type { CountryGameState } from "@/lib/db/types/gameState";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { resolveCountryOfficeLayout } from "./rules/officeLayout";

export async function loadRuntimeCountryOffices(
  db: Db,
  countryId: CountryId,
  preset?: string,
  session?: ClientSession
) {
  const activePreset = preset ?? (await getGameStatePreset(db));
  const country =
    countryId === "RU" && activePreset === "1991-default"
      ? await db.collection<CountryGameState>("countryGameStates").findOne(
          { _id: "RU" },
          {
            session,
            projection: {
              ruSovietSuccessionSinceTurn: 1,
              ruPresidencySinceTurn: 1,
              ruCongressDissolvedSinceTurn: 1,
              ruFederalAssemblySinceTurn: 1,
            },
          }
        )
      : null;
  return resolveCountryOfficeLayout(getCountryConfigForRuntime(countryId, activePreset, country));
}

export type RuntimeCountryOffices = Awaited<ReturnType<typeof loadRuntimeCountryOffices>>;
