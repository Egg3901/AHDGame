import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";

/**
 * The two admin switches that decide whether NPP-run belligerents fight offensively.
 *
 * They are separate on purpose: initiating an attack and following an ally into one
 * are different commitments, and an admin may reasonably want the second without the
 * first. Both fail closed. An NPP army with neither switch on still DEFENDS, because
 * defence is forced on whoever holds the ground and needs no order.
 *
 * Neither flag touches a player government. Players declare through the cabinet battle
 * route and set their own standing orders in `theaterState.autoJoin`; these switches
 * only supply the intent that an NPP country has no player to supply for it.
 */
export interface NppOffensiveFlags {
  /** May an NPP belligerent queue a battle declaration of its own? */
  initiate: boolean;
  /** May an NPP belligerent join an ally's offensive where it already has troops? */
  join: boolean;
}

/**
 * Read one flag, failing closed.
 *
 * Absent means off rather than on: these switches let NPP armies attack without a
 * general or a technology model behind them, which loses offensives that a player-run
 * army would win, so a world that has never been configured must not start doing it.
 */
export function nppOffensiveFlagFrom(value: unknown): boolean {
  return value === true;
}

/** Both switches as stored, for callers that do not already hold a `gameState` row. */
export async function readNppOffensiveFlags(db: Db): Promise<NppOffensiveFlags> {
  const state = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { nppOffensiveInitiationEnabled: 1, nppOffensiveJoinEnabled: 1 } }
    );
  return {
    initiate: nppOffensiveFlagFrom(state?.nppOffensiveInitiationEnabled),
    join: nppOffensiveFlagFrom(state?.nppOffensiveJoinEnabled),
  };
}
