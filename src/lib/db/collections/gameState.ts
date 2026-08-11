import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "../types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Typed `gameState` collection (singleton doc `_id: "current"`).
 * Pass `db` when already connected to avoid an extra `getDb()` await.
 */
export async function getGameStateCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<GameState>("gameState");
}

/**
 * The world's active reset preset, or `undefined` when no world is seeded.
 *
 * ALWAYS reads the canonical `_id: "current"` document. The `gameState`
 * collection is NOT guaranteed to hold exactly one doc — a live world was found
 * carrying a `debt_ceiling_crisis` squatter alongside `current` — so an
 * unfiltered `findOne({})` returns whichever document Mongo happens to scan
 * first and silently falls back to the default preset (a 1953 world reading as
 * 2019). #3773 purges the squatters on reset; this helper is the read-side half,
 * and exists so preset-sensitive callers cannot reintroduce the unfiltered read
 * one at a time.
 *
 * Callers keep their own default (`?? DEFAULT_SEED_PRESET`, `?? "1953-default"`, …)
 * so this stays a pure "what does the world say" read.
 */
export async function getGameStatePreset(db?: Db): Promise<string | undefined> {
  const collection = await getGameStateCollection(db);
  const gs = await collection.findOne({ _id: "current" }, { projection: { preset: 1 } });
  return gs?.preset ?? undefined;
}

// Re-exported so existing server-side importers keep working. The constant
// itself lives in `constants/seedPreset` because client components need it and
// this module pulls in `mongodb`.
export { DEFAULT_SEED_PRESET };

/**
 * The world's preset, falling back to {@link DEFAULT_SEED_PRESET} when the
 * world does not state one. Use where a `string` is required and there is no
 * better era signal to hand.
 */
export async function getGameStatePresetOrDefault(db?: Db): Promise<string> {
  return (await getGameStatePreset(db)) ?? DEFAULT_SEED_PRESET;
}
