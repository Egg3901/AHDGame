import type { Db } from "mongodb";
import type { CrisisAutoCooldown } from "@/lib/db/types/crisis";

const COLLECTION = "crisisAutoCooldowns";

/** Sentinel scope key for world-scoped (global) auto-crises. */
export const GLOBAL_SCOPE_KEY = "GLOBAL";

function key(templateKey: string, scopeKey: string): string {
  return `${templateKey}:${scopeKey}`;
}

/** Load every cooldown row, keyed by `${templateKey}:${scopeKey}`. */
export async function loadCooldownMap(db: Db): Promise<Map<string, CrisisAutoCooldown>> {
  const rows = await db.collection<CrisisAutoCooldown>(COLLECTION).find({}).toArray();
  return new Map(rows.map((r) => [r._id, r]));
}

/** True when `cooldownTurns` have NOT yet elapsed since the last spawn. */
export function isOnCooldown(
  cooldowns: Map<string, CrisisAutoCooldown>,
  templateKey: string,
  scopeKey: string,
  currentTurn: number,
  cooldownTurns: number
): boolean {
  const row = cooldowns.get(key(templateKey, scopeKey));
  if (!row) return false;
  return currentTurn - row.lastSpawnTurn < cooldownTurns;
}

/** Stamp the last-spawn turn for a template/scope. Updates the in-memory map too
 *  so a single turn pass won't double-spawn before the DB reload. */
export async function stampCooldown(
  db: Db,
  cooldowns: Map<string, CrisisAutoCooldown>,
  templateKey: string,
  scopeKey: string,
  currentTurn: number
): Promise<void> {
  const _id = key(templateKey, scopeKey);
  const now = new Date();
  await db
    .collection<CrisisAutoCooldown>(COLLECTION)
    .updateOne(
      { _id },
      { $set: { templateKey, scopeKey, lastSpawnTurn: currentTurn, updatedAt: now } },
      { upsert: true }
    );
  cooldowns.set(_id, { _id, templateKey, scopeKey, lastSpawnTurn: currentTurn, updatedAt: now });
}
