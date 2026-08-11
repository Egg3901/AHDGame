import type { Db, ObjectId } from "mongodb";
import "@/lib/events/pree/index";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import type { EventEffect } from "@/lib/db/types/events";
import { STAT_META } from "@/lib/stats/statMeta";
import { getEventHandler } from "@/lib/events/substrate/registry";
import { pickTier } from "@/lib/events/substrate/tiers";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import type { CountryId } from "@/lib/constants/countries";

export interface ActiveEventOptionDto {
  id: string;
  label: string;
  description: string;
  isDefault: boolean;
  /** Non-zero when this option's primaryStat shifts the roll. Positive = helping, negative = hurting. */
  statAdjustment?: { stat: string; label: string; delta: number };
}

export interface ActiveEventDto {
  instanceId: string;
  kind: string;
  title: string;
  headline: string;
  body: string;
  image?: string;
  offeredAtTurn: number;
  expiresAtRealtimeMs: number;
  options: ActiveEventOptionDto[];
  defaultOptionId: string;
}

export interface ResolvedEventDto {
  instanceId: string;
  kind: string;
  title: string;
  optionLabel: string;
  tierLabel: string;
  effects: EventEffect[];
  resolvedAt: string;
  /** "player" = chosen; "timeout" = swept to the default option. */
  reason: "player" | "timeout";
}

/** Only surface outcomes this recent on the actions page. */
const RESOLVED_VISIBILITY_WINDOW_MS = 48 * 60 * 60 * 1000;

export function interpolateEventText(text: string, payload: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in payload ? String(payload[key]) : `{${key}}`
  );
}

/**
 * The character's most recent terminal event, shaped for the actions-page
 * outcome card. Effects are recomputed from the handler table + stored roll —
 * they are the applied tier's effects, not the full outcome table.
 */
export async function buildLastResolvedForCharacter(
  db: Db,
  characterId: ObjectId,
  nowMs: number
): Promise<ResolvedEventDto | null> {
  const instance = await getEventInstancesCollection(db).findOne(
    {
      scope: "character",
      scopeId: characterId,
      status: { $in: ["resolved", "expired"] },
    },
    { sort: { resolvedAt: -1 } }
  );
  if (!instance || !instance.resolvedAt || !instance.resolvedOptionId) {
    return null;
  }
  if (nowMs - instance.resolvedAt.getTime() > RESOLVED_VISIBILITY_WINDOW_MS) {
    return null;
  }

  const handler = getEventHandler(instance.kind);
  const option = handler?.options.find((o) => o.id === instance.resolvedOptionId);
  if (!handler || !option) {
    return null;
  }

  const definition = await getEventDefinitionsCollection(db).findOne({ kind: instance.kind });
  const defOption = definition?.options.find((o) => o.id === option.id);
  const tier = pickTier(option.outcomeTable, instance.roll);

  return {
    instanceId: instance._id.toHexString(),
    kind: instance.kind,
    title: definition?.title ?? instance.kind,
    optionLabel: defOption?.label ?? option.label,
    tierLabel: instance.resolvedTierLabel ?? tier.label,
    effects: tier.effects,
    resolvedAt: instance.resolvedAt.toISOString(),
    reason: instance.resolveReason ?? "player",
  };
}

/**
 * Shape the character's pending event for the client. Handler options are the
 * source of truth for ids and the default; the definition row supplies display
 * copy. Outcome tables never leave the server.
 */
export async function buildActiveEventForCharacter(
  db: Db,
  characterId: ObjectId,
  nowMs: number
): Promise<ActiveEventDto | null> {
  const instance = await getEventInstancesCollection(db).findOne({
    scope: "character",
    scopeId: characterId,
    status: "pending",
  });
  // Expired-but-unswept instances belong to the sweep — never show a dead countdown.
  if (!instance || instance.expiresAtRealtimeMs <= nowMs) {
    return null;
  }

  const handler = getEventHandler(instance.kind);
  if (!handler) {
    return null;
  }

  const definition = await getEventDefinitionsCollection(db).findOne({ kind: instance.kind });
  const defOptionById = new Map((definition?.options ?? []).map((o) => [o.id, o]));

  // Load character stats once if any option has a primaryStat, so we can show the
  // pre-resolve adjustment badge on the pending card.
  const hasStatOptions = handler.options.some((o) => o.primaryStat);
  let charStats: Record<string, number> | undefined;
  if (hasStatOptions && instance.scope === "character") {
    const character = await db
      .collection("characters")
      .findOne({ _id: instance.scopeId }, { projection: { stats: 1 } });
    charStats = character?.stats as Record<string, number> | undefined;
  }

  return {
    instanceId: instance._id.toHexString(),
    kind: instance.kind,
    title: definition?.title ?? instance.kind,
    headline: interpolateEventText(definition?.headline ?? "", instance.payload),
    body: interpolateEventText(definition?.body ?? "", instance.payload),
    image: definition?.image,
    offeredAtTurn: instance.offeredAtTurn,
    expiresAtRealtimeMs: instance.expiresAtRealtimeMs,
    options: handler.options.map((option) => {
      const defOption = defOptionById.get(option.id);
      let statAdjustment: ActiveEventOptionDto["statAdjustment"];
      if (option.primaryStat && charStats) {
        const statValue = charStats[option.primaryStat] ?? 5.5;
        const delta = Math.round((statValue - 5.5) * 4);
        if (delta !== 0) {
          statAdjustment = {
            stat: option.primaryStat,
            label: STAT_META[option.primaryStat].label,
            delta,
          };
        }
      }
      return {
        id: option.id,
        label: defOption?.label ?? option.label,
        description: defOption?.description ?? option.description,
        isDefault: option.id === handler.defaultOptionId,
        statAdjustment,
      };
    }),
    defaultOptionId: handler.defaultOptionId,
  };
}

/**
 * The country's pending event, shaped for the executive's actions-page card.
 * Country-scope events never have `primaryStat` options in v1 (no roll to
 * adjust), so this omits the stat-adjustment lookup entirely.
 */
export async function buildActiveEventForCountry(
  db: Db,
  countryId: CountryId,
  nowMs: number
): Promise<ActiveEventDto | null> {
  const instance = await getEventInstancesCollection(db).findOne({
    scope: "country",
    scopeId: countryScopeId(countryId),
    status: "pending",
  });
  if (!instance || instance.expiresAtRealtimeMs <= nowMs) {
    return null;
  }

  const handler = getEventHandler(instance.kind);
  if (!handler) {
    return null;
  }

  const definition = await getEventDefinitionsCollection(db).findOne({ kind: instance.kind });
  const defOptionById = new Map((definition?.options ?? []).map((o) => [o.id, o]));

  return {
    instanceId: instance._id.toHexString(),
    kind: instance.kind,
    title: definition?.title ?? instance.kind,
    headline: interpolateEventText(definition?.headline ?? "", instance.payload),
    body: interpolateEventText(definition?.body ?? "", instance.payload),
    image: definition?.image,
    offeredAtTurn: instance.offeredAtTurn,
    expiresAtRealtimeMs: instance.expiresAtRealtimeMs,
    options: handler.options.map((option) => {
      const defOption = defOptionById.get(option.id);
      return {
        id: option.id,
        label: defOption?.label ?? option.label,
        description: defOption?.description ?? option.description,
        isDefault: option.id === handler.defaultOptionId,
      };
    }),
    defaultOptionId: handler.defaultOptionId,
  };
}
