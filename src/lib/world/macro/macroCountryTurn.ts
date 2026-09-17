import type { Db } from "mongodb";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import { computeMacroContribution } from "./kernel";
import { isMacroTickTurn, MACRO_TICK_INTERVAL } from "./schedule";

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
  const tickBucket = (turn - 1) % MACRO_TICK_INTERVAL;
  const countries = await collection.find({ tickBucket }).toArray();
  const updatedEntityIds: string[] = [];
  const now = new Date();

  for (const country of countries) {
    // Retained as an invariant check and for simple test/in-memory adapters
    // that do not implement Mongo filters.
    if (!isMacroTickTurn(turn, country.entityId)) continue;
    updatedEntityIds.push(country.entityId);
  }
  const due = countries.filter((country) => isMacroTickTurn(turn, country.entityId));
  if (due.length > 0) {
    await collection.bulkWrite(
      due.map((country) => ({
        updateOne: {
          filter: { _id: country._id },
          update: {
            $set: {
              contribution: computeMacroContribution(country, turn),
              lastMacroTickTurn: turn,
              updatedAt: now,
            },
          },
        },
      })),
      { ordered: false }
    );
  }

  return {
    countriesConsidered: countries.length,
    countriesUpdated: updatedEntityIds.length,
    updatedEntityIds,
  };
}
