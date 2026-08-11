import type { Db, ObjectId } from "mongodb";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import type { EventInstance } from "@/lib/db/types/events";
import { STAT_META } from "@/lib/stats/statMeta";
import { updateCharacterCooldownLedger, updateCountryCooldownLedger } from "./cooldown";
import { emitOutcomeNewsWire } from "./outcomeNews";
import { getEventHandler } from "./registry";
import { pickTier } from "./tiers";
import type { EventResolveContext, ResolveEventHooks } from "./types";

export class EventNotResolvableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventNotResolvableError";
  }
}

export async function resolveEvent(
  db: Db,
  instanceId: ObjectId,
  optionId: string,
  reason: "player" | "timeout",
  currentTurn: number,
  hooks?: ResolveEventHooks
): Promise<EventInstance> {
  const coll = getEventInstancesCollection(db);
  const instance = await coll.findOne({ _id: instanceId });
  if (!instance) {
    throw new EventNotResolvableError(
      `resolveEvent: instance ${instanceId.toHexString()} not found`
    );
  }
  if (instance.status !== "pending") {
    throw new EventNotResolvableError(
      `resolveEvent: instance ${instanceId.toHexString()} is ${instance.status}`
    );
  }
  if (reason === "player" && Date.now() > instance.expiresAtRealtimeMs) {
    throw new EventNotResolvableError("resolveEvent: instance has expired");
  }

  const handler = getEventHandler(instance.kind);
  if (!handler) {
    throw new EventNotResolvableError(`resolveEvent: no handler for kind ${instance.kind}`);
  }

  const option = handler.options.find((o) => o.id === optionId);
  if (!option) {
    throw new Error(`resolveEvent: no option "${optionId}" on handler for ${instance.kind}`);
  }

  let effectiveRoll = instance.roll;
  let statAdjustment: EventResolveContext["statAdjustment"];

  if (option.primaryStat && instance.scope === "character") {
    const character = await db
      .collection("characters")
      .findOne({ _id: instance.scopeId }, { projection: { stats: 1 } });
    const statValue =
      (character?.stats as Record<string, number> | undefined)?.[option.primaryStat] ?? 5.5;
    const delta = Math.round((statValue - 5.5) * 4);
    effectiveRoll = Math.max(1, Math.min(100, instance.roll + delta));
    if (delta !== 0) {
      statAdjustment = {
        stat: option.primaryStat,
        label: STAT_META[option.primaryStat].label,
        delta,
      };
    }
  }

  const tier = pickTier(option.outcomeTable, effectiveRoll);
  const ctx: EventResolveContext = {
    db,
    currentTurn,
    instance,
    option,
    tier,
    reason,
    statAdjustment,
  };

  if (handler.applyEffects) {
    await handler.applyEffects(ctx);
  }
  if (handler.onResolve) {
    await handler.onResolve(ctx);
  }

  const now = new Date();
  const terminalStatus = reason === "timeout" ? "expired" : "resolved";
  const update = await coll.findOneAndUpdate(
    { _id: instanceId, status: "pending" },
    {
      $set: {
        status: terminalStatus,
        resolvedAt: now,
        resolvedOptionId: optionId,
        resolvedTierLabel: tier.label,
        resolveReason: reason,
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );

  if (!update) {
    throw new EventNotResolvableError(
      `resolveEvent: instance ${instanceId.toHexString()} was resolved concurrently`
    );
  }

  if (update.scope === "character") {
    await updateCharacterCooldownLedger(db, update.scopeId, currentTurn);
  } else if (update.scope === "country") {
    await updateCountryCooldownLedger(db, update.scopeId, currentTurn);
  }

  // Notable outcomes (record fines, scandals, viral moments) post to the
  // National Wire Service. Best-effort — never let a feed failure break
  // resolution or the turn sweep.
  try {
    await emitOutcomeNewsWire(db, update, tier);
  } catch {
    // swallow: the event is already resolved and that's what matters
  }

  await hooks?.onResolved?.(update, ctx);
  return update;
}
