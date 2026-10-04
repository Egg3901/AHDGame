import type { Db, ObjectId } from "mongodb";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import type { EventInstance, OutcomeTier } from "@/lib/db/types/events";
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
  hooks?: ResolveEventHooks,
  preset?: string,
  treasuryCashLedgerEnabled = false,
  actorId?: string
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
  if (
    reason === "player" &&
    Date.now() > instance.expiresAtRealtimeMs &&
    !instance.resolutionClaim
  ) {
    throw new EventNotResolvableError("resolveEvent: instance has expired");
  }

  const handler = getEventHandler(instance.kind);
  if (!handler) {
    throw new EventNotResolvableError(`resolveEvent: no handler for kind ${instance.kind}`);
  }

  let option = handler.options.find((o) => o.id === optionId);
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

  let tier = pickTier(option.outcomeTable, effectiveRoll);
  let resolutionTurn = currentTurn;
  let resolutionReason = reason;
  let resolutionPreset = preset ?? (await getGameStatePresetOrDefault(db));
  let resolutionStatAdjustment = statAdjustment;
  const hasTreasuryAlternative = handler.options.some((candidate) =>
    candidate.outcomeTable.some((candidateTier) =>
      candidateTier.effects.some((effect) => effect.type === "treasuryDelta")
    )
  );
  const claimFundedChoice =
    instance.scope === "country" &&
    (instance.resolutionClaim !== undefined ||
      (treasuryCashLedgerEnabled && hasTreasuryAlternative));
  const useFrozenFundedPath =
    instance.scope === "country" &&
    (treasuryCashLedgerEnabled || instance.resolutionClaim !== undefined);

  if (claimFundedChoice) {
    const claim = instance.resolutionClaim;
    if (claim) {
      if (
        reason !== "timeout" &&
        (claim.optionId !== optionId ||
          claim.reason !== reason ||
          (actorId && claim.actorId !== actorId))
      ) {
        throw new EventNotResolvableError(
          `resolveEvent: instance ${instanceId.toHexString()} is reserved for another choice`
        );
      }
      const claimedOption = handler.options.find((candidate) => candidate.id === claim.optionId);
      if (!claimedOption) {
        throw new EventNotResolvableError("resolveEvent: reserved option is no longer available");
      }
      option = claimedOption;
      tier = claim.tier as OutcomeTier;
      resolutionTurn = claim.turn;
      resolutionReason = claim.reason;
      resolutionPreset = claim.preset;
      resolutionStatAdjustment = claim.statAdjustment;
    } else {
      const claimValue = {
        optionId: option.id,
        reason,
        ...(actorId ? { actorId } : {}),
        turn: currentTurn,
        preset: resolutionPreset,
        effectiveRoll,
        tier,
        ...(statAdjustment ? { statAdjustment } : {}),
        claimedAt: new Date(),
      };
      const reserved = await coll.findOneAndUpdate(
        { _id: instanceId, status: "pending", resolutionClaim: { $exists: false } },
        { $set: { resolutionClaim: claimValue, updatedAt: claimValue.claimedAt } },
        { returnDocument: "after" }
      );
      if (!reserved?.resolutionClaim) {
        const winner = await coll.findOne({ _id: instanceId, status: "pending" });
        if (!winner?.resolutionClaim) {
          throw new EventNotResolvableError(
            `resolveEvent: instance ${instanceId.toHexString()} was resolved concurrently`
          );
        }
        if (
          reason !== "timeout" &&
          (winner.resolutionClaim.optionId !== optionId ||
            winner.resolutionClaim.reason !== reason ||
            (actorId && winner.resolutionClaim.actorId !== actorId))
        ) {
          throw new EventNotResolvableError(
            `resolveEvent: instance ${instanceId.toHexString()} is reserved for another choice`
          );
        }
        const claimedOption = handler.options.find(
          (candidate) => candidate.id === winner.resolutionClaim!.optionId
        );
        if (!claimedOption) {
          throw new EventNotResolvableError("resolveEvent: reserved option is no longer available");
        }
        option = claimedOption;
        tier = winner.resolutionClaim.tier;
        resolutionTurn = winner.resolutionClaim.turn;
        resolutionReason = winner.resolutionClaim.reason;
        resolutionPreset = winner.resolutionClaim.preset;
        resolutionStatAdjustment = winner.resolutionClaim.statAdjustment;
      }
    }
  }
  const ctx: EventResolveContext = {
    db,
    currentTurn: resolutionTurn,
    instance,
    option,
    tier,
    reason: resolutionReason,
    statAdjustment: resolutionStatAdjustment,
    preset: resolutionPreset,
    treasuryCashLedgerEnabled: useFrozenFundedPath,
  };

  if (handler.applyEffects) {
    await handler.applyEffects(ctx);
  }
  if (handler.onResolve) {
    await handler.onResolve(ctx);
  }

  const now = new Date();
  const terminalStatus = resolutionReason === "timeout" ? "expired" : "resolved";
  const update = await coll.findOneAndUpdate(
    {
      _id: instanceId,
      status: "pending",
      ...(claimFundedChoice ? { "resolutionClaim.optionId": option.id } : {}),
    },
    {
      $set: {
        status: terminalStatus,
        resolvedAt: now,
        resolvedOptionId: option.id,
        resolvedTierLabel: tier.label,
        resolveReason: resolutionReason,
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
    await updateCountryCooldownLedger(db, update.scopeId, resolutionTurn);
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
