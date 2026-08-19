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

/** True when the template/scope is armed (never spawned, or cleared since). */
export function isArmed(
  cooldowns: Map<string, CrisisAutoCooldown>,
  templateKey: string,
  scopeKey: string
): boolean {
  const row = cooldowns.get(key(templateKey, scopeKey));
  return row?.armed !== false;
}

/** Re-arm a template/scope after its trigger condition has cleared. */
export async function setArmed(
  db: Db,
  cooldowns: Map<string, CrisisAutoCooldown>,
  templateKey: string,
  scopeKey: string,
  armed: boolean
): Promise<void> {
  const _id = key(templateKey, scopeKey);
  const row = cooldowns.get(_id);
  if (!row || row.armed === armed) return;
  await db.collection<CrisisAutoCooldown>(COLLECTION).updateOne({ _id }, { $set: { armed } });
  cooldowns.set(_id, { ...row, armed });
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
  await db.collection<CrisisAutoCooldown>(COLLECTION).updateOne(
    { _id },
    {
      $set: {
        templateKey,
        scopeKey,
        lastSpawnTurn: currentTurn,
        // Disarm on spawn. Only a cleared condition re-arms it.
        armed: false,
        updatedAt: now,
      },
    },
    { upsert: true }
  );
  cooldowns.set(_id, {
    _id,
    templateKey,
    scopeKey,
    lastSpawnTurn: currentTurn,
    armed: false,
    updatedAt: now,
  });
}
