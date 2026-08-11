import type { Db } from "mongodb";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import type { EventInstance } from "@/lib/db/types/events";
import { getDefaultOptionId } from "./registry";
import { resolveEvent } from "./resolve";
import type { ResolveEventHooks } from "./types";

export interface SweepExpiredResult {
  swept: EventInstance[];
  skipped: { instanceId: string; reason: string }[];
}

/**
 * Resolve pending instances whose realtime OR turn window has elapsed.
 *
 * Turn expiry exists because the realtime window is meaningless in a headless
 * sim (1000 turns in hours of wall-clock), where it left the first offer parked
 * in each country's only pending slot forever.
 */
export async function sweepExpired(
  db: Db,
  currentTurn: number,
  nowMs: number = Date.now(),
  hooks?: ResolveEventHooks
): Promise<SweepExpiredResult> {
  const coll = getEventInstancesCollection(db);
  const expired = await coll
    .find({
      status: "pending",
      $or: [{ expiresAtRealtimeMs: { $lte: nowMs } }, { expiresAtTurn: { $lte: currentTurn } }],
    })
    .toArray();

  const swept: EventInstance[] = [];
  const skipped: SweepExpiredResult["skipped"] = [];

  for (const instance of expired) {
    const defaultOptionId = getDefaultOptionId(instance.kind);
    if (!defaultOptionId) {
      skipped.push({
        instanceId: instance._id.toHexString(),
        reason: `no default option for kind ${instance.kind}`,
      });
      continue;
    }

    try {
      const resolved = await resolveEvent(
        db,
        instance._id,
        defaultOptionId,
        "timeout",
        currentTurn,
        hooks
      );
      swept.push(resolved);
    } catch (err) {
      skipped.push({
        instanceId: instance._id.toHexString(),
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { swept, skipped };
}
