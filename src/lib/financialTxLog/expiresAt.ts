import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import {
  TX_TTL_TURNS,
  DEFAULT_TURN_LENGTH_MINUTES,
  TX_TTL_DEFAULT_MS,
} from "@/lib/db/types/financialTxLog";

/**
 * Compute the `expiresAt` Date for a tx emitted at `createdAt`, using the
 * current `gameConfig.turnLengthMinutes` to size the 168-turn retention
 * window. Reads `gameConfig` once per call.
 *
 * Why a helper: emitters used to hardcode `createdAt + TX_TTL_MS` (96h
 * wall-clock). Switching the constant alone would silently shrink retention
 * if turn cadence changes; routing every emit through this helper keeps
 * "168 turns" the meaningful unit even when admins re-time the game.
 */
export async function computeExpiresAt(db: Db, createdAt: Date): Promise<Date> {
  const cfg = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  const turnLength = cfg?.turnLengthMinutes ?? DEFAULT_TURN_LENGTH_MINUTES;
  const ttlMs = TX_TTL_TURNS * turnLength * 60_000;
  return new Date(createdAt.getTime() + ttlMs);
}

/**
 * Synchronous variant for batch loops where the caller has already loaded
 * `turnLengthMinutes` once. Avoids re-reading gameConfig on every entry.
 */
export function computeExpiresAtSync(createdAt: Date, turnLengthMinutes: number): Date {
  const ttlMs = TX_TTL_TURNS * turnLengthMinutes * 60_000;
  return new Date(createdAt.getTime() + ttlMs);
}

/**
 * Read just the `turnLengthMinutes` value from gameConfig. Falls back to the
 * default if absent. Used by emitTxBulk to load it once per call.
 */
export async function loadTurnLengthMinutes(db: Db): Promise<number> {
  const cfg = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  return cfg?.turnLengthMinutes ?? DEFAULT_TURN_LENGTH_MINUTES;
}

/**
 * Last-resort default expiresAt — no DB lookup. Tests + ad-hoc scripts that
 * don't have access to the gameConfig collection use this. Equivalent to the
 * default 168-turn × 60-min cadence (= 7 IRL days).
 */
export function defaultExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TX_TTL_DEFAULT_MS);
}
