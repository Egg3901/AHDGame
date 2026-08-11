import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import "@/lib/events/pree/index";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { badRequest, handleRouteError, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { getEventHandler } from "@/lib/events/substrate/registry";
import { EventNotResolvableError, resolveEvent } from "@/lib/events/substrate/resolve";
import {
  notifyCountryEventResolved,
  notifyPlayerEventResolved,
} from "@/lib/events/pree/notifications";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { getGameState } from "@/lib/gameState";
import type { CountryId } from "@/lib/constants/countries";
import type { EventEffect } from "@/lib/db/types/events";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({ optionId: z.string().min(1).max(64) });

// POST /api/events/[id]/resolve - Resolve the caller's pending random event with a chosen option.
// Auth: requireAuthWithCharacter (character scope: instance owner only; country scope: the
//   character currently holding the country's national executive office)
// Errors: 400, 401, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      throw badRequest("Invalid event id");
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const instanceId = new ObjectId(id);
    const character = auth.user.character;

    const instance = await getEventInstancesCollection(db).findOne({ _id: instanceId });
    if (!instance) {
      throw notFound("Event not found");
    }

    if (instance.scope === "character") {
      if (!instance.scopeId.equals(character._id)) {
        throw notFound("Event not found");
      }
    } else if (instance.scope === "country") {
      const countryId = instance.payload.countryId as CountryId | undefined;
      const leaderCharId = countryId ? await getHeadOfGovernmentCharacterId(db, countryId) : null;
      if (!leaderCharId || !leaderCharId.equals(character._id)) {
        throw notFound("Event not found");
      }
    } else {
      throw notFound("Event not found");
    }

    if (instance.status !== "pending") {
      throw badRequest("This event has already been resolved.");
    }
    if (Date.now() > instance.expiresAtRealtimeMs) {
      throw badRequest("This event has expired.");
    }

    const handler = getEventHandler(instance.kind);
    if (!handler || !handler.options.some((o) => o.id === parsed.data.optionId)) {
      throw badRequest("Invalid option for this event.");
    }

    if (instance.scope === "country") {
      const definition = await getEventDefinitionsCollection(db).findOne({ kind: instance.kind });
      if (definition?.deciderRole !== "executive") {
        throw badRequest("This event is not a decidable country-scope event.");
      }
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? instance.offeredAtTurn;

    let tierLabel = "";
    let effects: EventEffect[] = [];
    let statAdjustment: { stat: string; label: string; delta: number } | null = null;
    try {
      await resolveEvent(db, instanceId, parsed.data.optionId, "player", currentTurn, {
        onResolved: async (resolved, ctx) => {
          tierLabel = ctx.tier.label;
          effects = ctx.tier.effects;
          statAdjustment = ctx.statAdjustment ?? null;
          if (resolved.scope === "country") {
            await notifyCountryEventResolved(character.userId, resolved, ctx);
          } else {
            await notifyPlayerEventResolved(character.userId, resolved, ctx);
          }
        },
      });
    } catch (error) {
      if (error instanceof EventNotResolvableError) {
        throw badRequest("This event can no longer be resolved.");
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      optionId: parsed.data.optionId,
      tierLabel,
      effects,
      statAdjustment,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
