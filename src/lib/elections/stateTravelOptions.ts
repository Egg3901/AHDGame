/**
 * The states a presidential candidate can move to, named and priced.
 *
 * One definition, shared by every surface that offers a move: the primary
 * screen's camp control, the campaign manager's travel control, and the detail
 * builder behind both. Two lists would eventually quote two different prices
 * for the same journey.
 *
 * Named rather than left as two-letter codes because the pickers filter on the
 * name. Handed the code as the name, typing "Iowa" matched nothing.
 */

import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import { ELECTORAL_VOTE_UNITS, getTravelActionCost } from "@/lib/constants/states";
import type { StateTravelOption } from "@/lib/elections/dto/campaignStatePresence";

export type { StateTravelOption };

/** Every state that casts electoral votes, deduplicated across split units. */
export const TRAVEL_STATE_IDS = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];

export interface StateTravelOptions {
  options: StateTravelOption[];
  stateNameById: Record<string, string>;
  /** The apportionment preset the costs were priced against. */
  preset: string | undefined;
}

export async function loadStateTravelOptions(db: Db, preset?: string): Promise<StateTravelOptions> {
  const resolvedPreset =
    preset ??
    (await db.collection<{ _id: string; preset?: string }>("gameState").findOne({ _id: "current" }))
      ?.preset;

  const states = await db
    .collection<State>("states")
    .find({ _id: { $in: TRAVEL_STATE_IDS } })
    .toArray();
  const nameById = new Map(states.map((s) => [s._id as string, s.name]));

  const stateNameById: Record<string, string> = {};
  for (const stateId of TRAVEL_STATE_IDS) {
    stateNameById[stateId] = nameById.get(stateId) ?? stateId;
  }

  return {
    options: TRAVEL_STATE_IDS.map((id) => ({
      id,
      name: stateNameById[id],
      actionCost: getTravelActionCost(id, resolvedPreset),
    })),
    stateNameById,
    preset: resolvedPreset,
  };
}
