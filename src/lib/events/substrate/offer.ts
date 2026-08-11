import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import type { EventInstance } from "@/lib/db/types/events";
import { getEventHandler } from "./registry";
import type { OfferEventInput, ResolveEventHooks } from "./types";

export const EVENT_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class ActiveEventConflictError extends Error {
  constructor(scopeId: ObjectId) {
    super(`offerEvent: pending instance already exists for scope ${scopeId.toHexString()}`);
    this.name = "ActiveEventConflictError";
  }
}

export async function hasPendingEvent(
  db: Db,
  scope: EventInstance["scope"],
  scopeId: ObjectId
): Promise<boolean> {
  const existing = await getEventInstancesCollection(db).findOne({
    scope,
    scopeId,
    status: "pending",
  });
  return existing !== null;
}

/**
 * Create a pending event instance. Enforces one pending slot per scope.
 * The outcome roll is stored at offer time and interpreted at resolve.
 */
export async function offerEvent(
  db: Db,
  input: OfferEventInput,
  hooks?: ResolveEventHooks
): Promise<EventInstance> {
  if (!getEventHandler(input.kind)) {
    throw new Error(`offerEvent: no handler registered for kind ${input.kind}`);
  }
  if (input.roll < 1 || input.roll > 100) {
    throw new Error(`offerEvent: roll must be 1–100, got ${input.roll}`);
  }

  const coll = getEventInstancesCollection(db);
  const conflict = await coll.findOne({
    scope: input.scope,
    scopeId: input.scopeId,
    status: "pending",
  });
  if (conflict) {
    throw new ActiveEventConflictError(input.scopeId);
  }

  const now = input.offeredAt ?? new Date();
  const instance: EventInstance = {
    _id: new ObjectId(),
    kind: input.kind,
    scope: input.scope,
    scopeId: input.scopeId,
    definitionVersion: input.definitionVersion,
    status: "pending",
    roll: input.roll,
    payload: input.payload,
    offeredAtTurn: input.offeredAtTurn,
    offeredAt: now,
    expiresAtRealtimeMs: input.expiresAtRealtimeMs,
    ...(input.expiresAtTurn != null ? { expiresAtTurn: input.expiresAtTurn } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await coll.insertOne(instance);
  await hooks?.onOffered?.(instance);
  return instance;
}

export function computeExpiresAtRealtimeMs(offeredAt: Date = new Date()): number {
  return offeredAt.getTime() + EVENT_RESPONSE_WINDOW_MS;
}

/**
 * Turns an offer may stand before it lapses. One in-game year at 48 turns/year —
 * long enough for a decision to be meaningful, short enough that a country is
 * not locked out of every subsequent event for the rest of a long run.
 */
export const EVENT_RESPONSE_WINDOW_TURNS = 48;

export function computeExpiresAtTurn(currentTurn: number): number {
  return currentTurn + EVENT_RESPONSE_WINDOW_TURNS;
}
