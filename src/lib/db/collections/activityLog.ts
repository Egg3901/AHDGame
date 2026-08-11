import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { ActivityLog } from "../types/activityLog";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Typed `activityLog` collection. Pass `db` when already connected to avoid
 * an extra `getDb()` await (e.g. turn processing).
 *
 * Indexes (created via migration / seeding):
 *   { timestamp: 1 }  expireAfterSeconds: 2592000  (30-day TTL)
 *   { userId: 1, timestamp: -1 }
 *   { characterId: 1, timestamp: -1 }
 *   { type: 1, timestamp: -1 }
 *   { ipAddress: 1, timestamp: -1 }
 *   text index on { username, characterName }
 */
export async function getActivityLogCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<ActivityLog>("activityLog");
}

export interface CharacterDeletedSnapshot {
  reason: "admin_delete" | "self_delete";
  userId: ObjectId;
  username: string;
  characterId?: ObjectId;
  characterName?: string;
  countryId?: CountryId;
  details?: Record<string, unknown>;
}

/**
 * Writes a `character_deleted` snapshot into `activityLog` immediately BEFORE a
 * character/account is hard-deleted, so the moderator activity drilldown retains
 * a marker (and identity strings) even for accounts with no other activity.
 *
 * NOTE: `activityLog` has a 30-day TTL, so this marker is not the durable
 * forensic record — retained `actionLogs`, `adminLog`, and `financialTxLog`
 * carry the beyond-30-day trail.
 */
export async function logCharacterDeleted(
  db: Db,
  snapshot: CharacterDeletedSnapshot
): Promise<void> {
  const reasonLabel = snapshot.reason === "admin_delete" ? "Deleted by admin" : "Self-deleted";
  await db.collection("activityLog").insertOne({
    _id: new ObjectId(),
    type: "character_deleted",
    timestamp: new Date(),
    userId: snapshot.userId,
    username: snapshot.username,
    characterId: snapshot.characterId,
    characterName: snapshot.characterName,
    countryId: snapshot.countryId,
    summary: `Character/account deleted (${reasonLabel})`,
    details: snapshot.details ?? {},
  });
}
