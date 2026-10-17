import type { Db } from "mongodb";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { getParliamentaryCountryIds } from "@/lib/turn/parliamentaryGovernment";
import { tickParliamentaryGovernmentConfidence } from "@/lib/uk/confidence/confidenceGaugeStore";

/** Tick shared confidence after the parliamentary government has been resolved. */
export async function runParliamentaryGovernmentConfidencePhase(
  db: Db,
  now: Date,
  turn: number
): Promise<void> {
  const preset = await getGameStatePreset(db);
  const registered = new Set(await getRegisteredCountryIds(db));
  const countryIds = getParliamentaryCountryIds(preset).filter(
    (countryId) => countryId !== "UK" && registered.has(countryId)
  );

  try {
    await tickParliamentaryGovernmentConfidence(db, { countryIds, now, turn, preset });
  } catch (error) {
    console.error("[turn] parliamentary government confidence tick failed:", error);
  }
}
