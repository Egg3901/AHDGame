/**
 * Handler-layer types for the event substrate.
 *
 * DB document shapes live in `@/lib/db/types/events`. Handlers register
 * code-first outcome tables and optional imperative hooks.
 */
import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types/character";
import type {
  EventDefinition,
  EventEffect,
  EventInstance,
  OutcomeTier,
} from "@/lib/db/types/events";
import type { StatKey } from "@/lib/stats/statsConstants";

export type { EventEffect, EventInstance, OutcomeTier };

export interface EventHandlerOption {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
  outcomeTable: OutcomeTier[];
  /** Which character stat modifies the effective roll for this option. */
  primaryStat?: StatKey;
}

export interface EventResolveContext {
  db: Db;
  currentTurn: number;
  instance: EventInstance;
  option: EventHandlerOption;
  tier: OutcomeTier;
  reason: "player" | "timeout";
  /** Set when option.primaryStat is defined — the stat label and roll delta applied. */
  statAdjustment?: { stat: string; label: string; delta: number };
}

export interface EventOfferContext {
  db: Db;
  character: Character;
  currentTurn: number;
  definition: EventDefinition;
}

export interface EventHandler {
  kind: string;
  options: EventHandlerOption[];
  defaultOptionId: string;
  buildPayload?(ctx: EventOfferContext): Promise<Record<string, unknown> | null>;
  applyEffects?(ctx: EventResolveContext): Promise<void>;
  onResolve?(ctx: EventResolveContext): Promise<void>;
}

export interface OfferEventInput {
  kind: string;
  scope: EventInstance["scope"];
  scopeId: ObjectId;
  definitionVersion: number;
  roll: number;
  payload: Record<string, unknown>;
  offeredAtTurn: number;
  offeredAt?: Date;
  expiresAtRealtimeMs: number;
  /** Optional turn-based companion window; see computeExpiresAtTurn. */

  expiresAtTurn?: number;
}

export interface ResolveEventHooks {
  onOffered?: (instance: EventInstance) => Promise<void>;
  onResolved?: (instance: EventInstance, ctx: EventResolveContext) => Promise<void>;
}
