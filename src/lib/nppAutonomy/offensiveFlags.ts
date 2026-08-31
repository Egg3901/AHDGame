import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";

/**
 * The two admin switches that decide whether NPP-run belligerents fight offensively:
 * `nppOffensiveInitiationEnabled` (declare an offensive of your own) and
 * `nppOffensiveJoinEnabled` (follow an ally into one).
 *
 * They are separate on purpose: initiating an attack and following an ally into one
 * are different commitments, and an admin may reasonably want the second without the
 * first. Both fail closed. An NPP army with neither switch on still DEFENDS, because
 * defence is forced on whoever holds the ground and needs no order.
 *
 * Neither flag touches a player government. Players declare through the cabinet battle
 * route and set their own standing orders in `theaterState.autoJoin`; these switches
 * only supply the intent that an NPP country has no player to supply for it.
 *
 * There is deliberately no "read both" helper. The initiation flag is only ever wanted
 * by the foreign-policy planner, which already loads the `gameState` row for its mode
 * and stage and parses the field out of that row rather than paying a second read.
 */

/**
 * Read one switch, failing closed.
 *
 * Absent means off rather than on: these switches let NPP armies attack without a
 * general or a technology model behind them, which loses offensives that a player-run
 * army would win, so a world that has never been configured must not start doing it.
 * A non-boolean (a legacy string `"true"`, say) is off for the same reason.
 */
export function nppOffensiveFlagFrom(value: unknown): boolean {
  return value === true;
}

/**
 * The join switch, for callers that do not already hold a `gameState` row — the battle
 * resolver and the cabinet forecast, both of which reach it through
 * `loadOffensiveOptInSources`.
 */
export async function readNppOffensiveJoinEnabled(db: Db): Promise<boolean> {
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { nppOffensiveJoinEnabled: 1 } });
  return nppOffensiveFlagFrom(state?.nppOffensiveJoinEnabled);
}
