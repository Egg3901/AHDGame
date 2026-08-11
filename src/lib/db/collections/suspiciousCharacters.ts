import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { SuspiciousCharacter } from "../types/activityLog";

/**
 * Typed `suspiciousCharacters` collection. Pass `db` when already connected
 * to avoid an extra `getDb()` await (e.g. turn processing).
 *
 * One document per currently-flagged character (_id == characterId).
 * Docs are upserted each turn by the suspiciousDetection phase and deleted
 * when all flags are cleared and all suppressedFlags have expired.
 */
export async function getSuspiciousCharactersCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<SuspiciousCharacter>("suspiciousCharacters");
}
