/**
 * Shell for the difficulty behavior policy: one `gameState` read, one pure
 * resolve. The policy table itself is in `rules/behavior.ts` and stays portable.
 *
 * Deliberately keyed off the persisted `singleplayerConfig.difficulty` rather
 * than the `SINGLEPLAYER` env flag that `rules/index.ts`'s resource tuning uses.
 * Two reasons:
 *   - Hosted worlds never persist `singleplayerConfig` (see its type comment),
 *     so multiplayer resolves to `normal` — the shipped behavior — without any
 *     caller needing to remember a guard.
 *   - The headless sim harness bootstraps a world and processes turns in a
 *     plain node process with no `SINGLEPLAYER` env, so an env-keyed read would
 *     have made difficulty unmeasurable in exactly the harness that has to
 *     measure it.
 */

import type { Db } from "mongodb";
import type { GameState, SingleplayerDifficulty } from "@/lib/db/types/gameState";
import { nppBehaviorPolicy, type NppBehaviorPolicy } from "./rules/behavior";

export type { NppBehaviorPolicy };

/** Read the world's configured difficulty. Absent (hosted worlds) → undefined. */
export async function loadSingleplayerDifficulty(
  db: Db
): Promise<SingleplayerDifficulty | undefined> {
  const state = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { "singleplayerConfig.difficulty": 1 } });
  return state?.singleplayerConfig?.difficulty;
}

/** The behavior policy for this world. Hosted/legacy worlds get `normal`. */
export async function loadNppBehaviorPolicy(db: Db): Promise<NppBehaviorPolicy> {
  return nppBehaviorPolicy(await loadSingleplayerDifficulty(db));
}
