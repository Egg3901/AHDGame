import type { ObjectId } from "mongodb";
import type { EventDefinition, EventEffect, EventInstance } from "@/lib/db/types/events";
import { createNotification, createNotifications } from "@/lib/notifications";
import type { EventResolveContext } from "@/lib/events/substrate/types";

/** "pree.lotteryWin" → "Lottery Win". Strips the namespace, splits camelCase. */
function humanizeKind(kind: string): string {
  const bare = kind.includes(".") ? kind.slice(kind.lastIndexOf(".") + 1) : kind;
  return bare
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function signedMoney(n: number): string {
  return `${n < 0 ? "-" : "+"}$${Math.abs(n).toLocaleString("en-US")}`;
}

/** Short, player-facing one-liner summarizing what a resolved event changed. */
function summarizeEffects(effects: EventEffect[]): string {
  const parts: string[] = [];
  for (const e of effects) {
    switch (e.type) {
      case "favorability":
        parts.push(`Favorability ${signed(e.delta)}`);
        break;
      case "infamy":
        parts.push(`Infamy ${signed(e.delta)}`);
        break;
      case "politicalInfluence":
        parts.push(`Political influence ${signed(e.delta)}`);
        break;
      case "personalWealth":
        parts.push(`Personal wealth ${signedMoney(e.deltaAnchor)}`);
        break;
      case "campaignFunds":
        parts.push(`Campaign funds ${signed(e.deltaLocal)}`);
        break;
      case "campaignSupport":
        parts.push(`Support ${signed(e.delta)}`);
        break;
      case "corpSentiment":
        parts.push(`Corporate sentiment ${signed(e.delta)}`);
        break;
      case "custom":
        // Custom handlers (e.g. multi-turn annuities) describe themselves
        // elsewhere; they have no single delta to summarize here.
        break;
    }
  }
  return parts.join(", ");
}

/**
 * Build the title + body for a resolved-event notification. Pure so it can be
 * unit-tested. Turns the old "Event resolved" / bare tier-label pair into a
 * named, self-explanatory line: what the event was, the choice made, the
 * outcome, and the concrete effects.
 */
export function buildResolvedNotificationContent(
  instance: Pick<EventInstance, "kind">,
  ctx: Pick<EventResolveContext, "option" | "tier" | "reason" | "statAdjustment">
): { title: string; message: string } {
  const title = `${humanizeKind(instance.kind)} resolved`;
  const lead =
    ctx.reason === "timeout"
      ? "No response — the default outcome was applied."
      : `You chose "${ctx.option.label}."`;
  const effects = summarizeEffects(ctx.tier.effects);
  const outcome = effects ? `${ctx.tier.label} — ${effects}.` : `${ctx.tier.label}.`;
  const stat =
    ctx.statAdjustment && ctx.statAdjustment.delta !== 0
      ? ` (Roll ${ctx.statAdjustment.delta > 0 ? "+" : "−"}${Math.abs(ctx.statAdjustment.delta)} from ${ctx.statAdjustment.label}.)`
      : "";
  return { title, message: `${lead} ${outcome}${stat}` };
}

export async function notifyPlayerEventOffered(
  userId: ObjectId,
  definition: EventDefinition,
  instance: EventInstance
): Promise<void> {
  await createNotification({
    userId,
    type: "player_event",
    title: definition.title,
    message: definition.headline,
    metadata: {
      instanceId: instance._id.toHexString(),
      kind: instance.kind,
      expiresAtRealtimeMs: instance.expiresAtRealtimeMs,
    },
  });
}

export async function notifyPlayerEventResolved(
  userId: ObjectId,
  instance: EventInstance,
  ctx: EventResolveContext
): Promise<void> {
  const { title, message } = buildResolvedNotificationContent(instance, ctx);
  await createNotification({
    userId,
    type: "player_event_resolved",
    title,
    message,
    metadata: {
      instanceId: instance._id.toHexString(),
      optionId: ctx.option.id,
      tierLabel: ctx.tier.label,
      reason: ctx.reason,
    },
  });
}

export async function notifyPlayerEventsResolvedBatch(
  entries: Array<{ userId: ObjectId; instance: EventInstance; ctx: EventResolveContext }>
): Promise<void> {
  await createNotifications(
    entries.map(({ userId, instance, ctx }) => {
      const { title, message } = buildResolvedNotificationContent(instance, ctx);
      return {
        userId,
        type: "player_event_resolved" as const,
        title,
        message,
        metadata: {
          instanceId: instance._id.toHexString(),
          optionId: ctx.option.id,
          tierLabel: ctx.tier.label,
          reason: ctx.reason,
        },
      };
    })
  );
}

/**
 * "Decision required" notification for a country-scope event, sent to the
 * character currently holding the country's national executive office. When
 * the office is vacant there is no player to notify — this is a silent no-op
 * (not an error) and the timeout default applies via the existing sweep when
 * the response window elapses (plan §7: vacant executive must never block or
 * cost the treasury).
 */
export async function notifyCountryExecutiveEventOffered(
  executiveUserId: ObjectId,
  definition: EventDefinition,
  instance: EventInstance
): Promise<void> {
  await createNotification({
    userId: executiveUserId,
    type: "world_event_offered",
    title: definition.title,
    message: definition.headline,
    metadata: {
      instanceId: instance._id.toHexString(),
      kind: instance.kind,
      expiresAtRealtimeMs: instance.expiresAtRealtimeMs,
    },
  });
}

/** Resolved-event notification for the country-scope path. Same content shape as the character path. */
export async function notifyCountryEventResolved(
  userId: ObjectId,
  instance: EventInstance,
  ctx: EventResolveContext
): Promise<void> {
  const { title, message } = buildResolvedNotificationContent(instance, ctx);
  await createNotification({
    userId,
    type: "world_event_resolved",
    title,
    message,
    metadata: {
      instanceId: instance._id.toHexString(),
      optionId: ctx.option.id,
      tierLabel: ctx.tier.label,
      reason: ctx.reason,
    },
  });
}
