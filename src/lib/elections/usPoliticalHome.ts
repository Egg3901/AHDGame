import type { Db } from "mongodb";
import { IS_NUMERIC_BSON } from "@/lib/db/numericTypeFilter";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import { getHouseSeats } from "@/lib/constants/states";
import { admittedStateIdsAsOf } from "@/lib/elections/statehoodAdmission";

/**
 * Load the set of US state ids that currently host full state politics
 * (era apportionment + mid-game admissions).
 */
export async function loadUsPoliticalStateIds(db: Db): Promise<{
  preset: string | undefined;
  currentYear: number;
  admittedIds: Set<string>;
  politicalIds: Set<string>;
}> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, currentYear: 1 } });
  const preset = gameState?.preset;
  const currentYear = gameState?.currentYear ?? Number.POSITIVE_INFINITY;
  const admissionBearing = (await db
    .collection<State>("states")
    .find(
      { countryId: "US", admittedYear: IS_NUMERIC_BSON },
      { projection: { _id: 1, admittedYear: 1 } }
    )
    .toArray()) as unknown as Array<{ _id: string; admittedYear?: number }>;
  const admittedIds = new Set(admittedStateIdsAsOf(admissionBearing, currentYear));
  const politicalIds = new Set<string>([...Object.keys(getHouseSeats(preset)), ...admittedIds]);
  return { preset, currentYear, admittedIds, politicalIds };
}

/** Player-facing reject copy when someone tries to home in an unadmitted territory. */
export function unplayableTerritoryHomeError(stateName: string): string {
  return `${stateName} is a US territory and cannot be chosen as a home state until it is admitted to the Union.`;
}
