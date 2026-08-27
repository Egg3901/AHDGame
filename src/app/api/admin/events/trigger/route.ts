import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import "@/lib/events/pree/index";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { badRequest, conflict, notFound, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { Character } from "@/lib/db/types/character";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { getEventHandler } from "@/lib/events/substrate/registry";
import {
  ActiveEventConflictError,
  computeExpiresAtRealtimeMs,
  hasPendingEvent,
  offerEvent,
} from "@/lib/events/substrate/offer";
import { notifyPlayerEventOffered } from "@/lib/events/pree/notifications";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

const TriggerSchema = z.object({
  characterId: z.string().refine((v) => ObjectId.isValid(v), "Invalid characterId"),
  kind: z.string().min(1),
  // Optional forced outcome roll (1–100) so admins can target a specific tier.
  roll: z.number().int().min(1).max(100).optional(),
});

// POST /api/admin/events/trigger - Manually offer a specific event to a character.
// Auth: requireAdmin
// Errors: 400, 403, 404, 409
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, TriggerSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId, kind } = parsed.data;

    const db = await getDb();
    const scopeId = new ObjectId(characterId);

    const character = await db.collection<Character>("characters").findOne({ _id: scopeId });
    if (!character) {
      throw notFound("Character not found");
    }

    const definition = await getEventDefinitionsCollection(db).findOne({ kind });
    if (!definition) {
      throw notFound(`No event definition for kind ${kind}`);
    }
    if (definition.status === "retired") {
      throw badRequest("Cannot trigger a retired event definition");
    }
    if (kind.startsWith("worldEvents.")) {
      throw badRequest("World events cannot be triggered as character random events");
    }

    const handler = getEventHandler(kind);
    if (!handler) {
      throw badRequest(`No handler registered for kind ${kind}`);
    }

    if (await hasPendingEvent(db, "character", scopeId)) {
      throw conflict("Character already has a pending event — resolve or expire it first");
    }

    const currentTurn = await getCurrentTurn(db);
    // Random roll unless the admin forces a specific outcome tier.
    const roll = parsed.data.roll ?? Math.floor(Math.random() * 100) + 1;

    const payload =
      (handler.buildPayload
        ? await handler.buildPayload({ db, character, currentTurn, definition })
        : null) ?? {};

    let instance;
    try {
      instance = await offerEvent(db, {
        kind,
        scope: "character",
        scopeId,
        definitionVersion: definition.version,
        roll,
        payload,
        offeredAtTurn: currentTurn,
        expiresAtRealtimeMs: computeExpiresAtRealtimeMs(),
      });
    } catch (error) {
      if (error instanceof ActiveEventConflictError) {
        throw conflict("Character already has a pending event — resolve or expire it first");
      }
      throw error;
    }

    await notifyPlayerEventOffered(character.userId, definition, instance);

    return NextResponse.json({
      success: true,
      instance: {
        instanceId: instance._id.toHexString(),
        kind: instance.kind,
        title: definition.title,
        roll: instance.roll,
        offeredAtTurn: instance.offeredAtTurn,
        expiresAtRealtimeMs: instance.expiresAtRealtimeMs,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
