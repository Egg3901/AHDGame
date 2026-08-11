import type { Db } from "mongodb";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import { computeMacroContribution } from "./kernel";
import { isMacroTickTurn } from "./schedule";

export interface MacroCountryTurnResult {
  countriesConsidered: number;
  countriesUpdated: number;
  updatedEntityIds: string[];
}

/**
 * Refresh sphere-macro kernels on their deterministic six-turn schedule.
 * Non-tick turns are a no-op; held contributions stay as last computed.
 */
export async function processMacroCountryTurn(
  db: Db,
  turn: number
): Promise<MacroCountryTurnResult> {
  const collection = await getMacroCountriesCollection(db);
  const countries = await collection.find({}).toArray();
  const updatedEntityIds: string[] = [];
  const now = new Date();

  for (const country of countries) {
    if (!isMacroTickTurn(turn, country.entityId)) continue;

    const contribution = computeMacroContribution(country, turn);
    await collection.updateOne(
      { _id: country._id },
      {
        $set: {
          contribution,
          lastMacroTickTurn: turn,
          updatedAt: now,
        },
      }
    );
    updatedEntityIds.push(country.entityId);
  }

  return {
    countriesConsidered: countries.length,
    countriesUpdated: updatedEntityIds.length,
    updatedEntityIds,
  };
}
