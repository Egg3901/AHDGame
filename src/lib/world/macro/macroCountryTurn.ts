import { arabTradeMultiplier } from "@/lib/livingConflict/rules/arabRegional";
import type { LivingConflictState } from "@/lib/livingConflict/types";
import {
  crisisEconomicExposure,
  crisisMacroOutputMultiplier,
} from "@/lib/livingConflict/rules/economicExposure";
import type { Db } from "mongodb";
import { getMacroCountriesCollection } from "@/lib/db/collections/macroCountries";
import { computeMacroContribution } from "./kernel";
import { ACTIVE_MACRO_COUNTRY_FILTER, isActiveMacroCountry } from "./retirement";
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
  const countries = await collection.find({ tickBucket, ...ACTIVE_MACRO_COUNTRY_FILTER }).toArray();
  const updatedEntityIds: string[] = [];
  const now = new Date();

  for (const country of countries) {
    // Retained as an invariant check and for simple test/in-memory adapters
    // that do not implement Mongo filters.
    if (!isActiveMacroCountry(country)) continue;
    if (!isMacroTickTurn(turn, country.entityId)) continue;
    updatedEntityIds.push(country.entityId);
  }
  const due = countries.filter(
    (country) => isActiveMacroCountry(country) && isMacroTickTurn(turn, country.entityId)
  );
  if (due.length > 0) {
    const config = await db
      .collection("gameState")
      .findOne({ _id: "current" as never }, { projection: { livingConflictsEnabled: 1 } });
    const crisis = config?.livingConflictsEnabled
      ? await db
          .collection<LivingConflictState>("livingConflicts")
          .find(
            {
              defKey: {
                $in: ["yugoslav_dissolution", "russia_ukraine_security", "arab_uprisings"],
              },
            },
            {
              projection: {
                defKey: 1,
                hasOpened: 1,
                status: 1,
                tracks: 1,
                representedActors: 1,
                arabRegional: 1,
                realizedInfrastructureDamage: 1,
              },
            }
          )
          .toArray()
      : [];
    await collection.bulkWrite(
      due.map((country) => {
        const exposure = crisisEconomicExposure(
          crisis,
          { _id: country.entityId, countryId: country.entityId },
          country.livingConflictExposure,
          turn,
          MACRO_TICK_INTERVAL
        );
        const persistExposure =
          country.livingConflictExposure ||
          exposure.displacedShare > 0 ||
          exposure.hostingShare > 0 ||
          exposure.infrastructureDamage > 0;
        const baseShock =
          Number.isFinite(country.shockModifier) && country.shockModifier > 0
            ? country.shockModifier
            : 1;
        return {
          updateOne: {
            filter: { _id: country._id },
            update: {
              $set: {
                contribution: computeMacroContribution(
                  {
                    ...country,
                    shockModifier:
                      baseShock *
                      crisisMacroOutputMultiplier(exposure) *
                      arabTradeMultiplier(
                        crisis?.find((state) => state.defKey === "arab_uprisings"),
                        country.entityId
                      ),
                  },
                  turn
                ),
                ...(persistExposure ? { livingConflictExposure: exposure } : {}),
                lastMacroTickTurn: turn,
                updatedAt: now,
              },
            },
          },
        };
      }),
      { ordered: false }
    );
  }

  return {
    countriesConsidered: countries.length,
    countriesUpdated: updatedEntityIds.length,
    updatedEntityIds,
  };
}
