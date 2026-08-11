import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import "@/lib/events/pree/index";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { badRequest, conflict, notFound, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types/character";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { getEventHandler } from "@/lib/events/substrate/registry";
import {
  ActiveEventConflictError,
  computeExpiresAtRealtimeMs,
  hasPendingEvent,
  offerEvent,
} from "@/lib/events/substrate/offer";
import { countryScopeId } from "@/lib/events/substrate/countryScopeId";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { notifyCountryExecutiveEventOffered } from "@/lib/events/pree/notifications";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

const TriggerSchema = z.object({
  countryId: z.string().min(1),
  kind: z.string().min(1),
  // Optional forced outcome roll (1–100) so admins can target a specific tier.
  roll: z.number().int().min(1).max(100).optional(),
});

// POST /api/admin/events/trigger-country - Manually offer a country-scope World Event.
// Mirrors /api/admin/events/trigger for the country scope (World Events v1 Phase 0 —
// there is no scheduler yet, so this is the only producer of country-scope offers).
// Auth: requireAdmin
// Errors: 400, 401, 403, 404, 409
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, TriggerSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { kind } = parsed.data;

    if (!(parsed.data.countryId in COUNTRY_CONFIGS)) {
      throw badRequest(`Unknown countryId "${parsed.data.countryId}"`);
    }
    const countryId = parsed.data.countryId as CountryId;

    const db = await getDb();

    const definition = await getEventDefinitionsCollection(db).findOne({ kind });
    if (!definition) {
      throw notFound(`No event definition for kind ${kind}`);
    }
    if (definition.status === "retired") {
      throw badRequest("Cannot trigger a retired event definition");
    }
    if (definition.requiresCountryIds && !definition.requiresCountryIds.includes(countryId)) {
      throw badRequest(`Definition ${kind} is not eligible for country ${countryId}`);
    }

    const handler = getEventHandler(kind);
    if (!handler) {
      throw badRequest(`No handler registered for kind ${kind}`);
    }

    const scopeId = countryScopeId(countryId);
    if (await hasPendingEvent(db, "country", scopeId)) {
      throw conflict("This country already has a pending world event — resolve or expire it first");
    }

    const currentTurn = await getCurrentTurn(db);

    // Random roll unless the admin forces a specific outcome tier.
    const roll = parsed.data.roll ?? Math.floor(Math.random() * 100) + 1;

    const payload: Record<string, unknown> = { countryId };

    let instance;
    try {
      instance = await offerEvent(db, {
        kind,
        scope: "country",
        scopeId,
        definitionVersion: definition.version,
        roll,
        payload,
        offeredAtTurn: currentTurn,
        expiresAtRealtimeMs: computeExpiresAtRealtimeMs(),
      });
    } catch (error) {
      if (error instanceof ActiveEventConflictError) {
        throw conflict(
          "This country already has a pending world event — resolve or expire it first"
        );
      }
      throw error;
    }

    // Notify the sitting executive. A vacant office is a silent no-op here —
    // the timeout default applies on schedule via the existing sweep, and
    // Phase 0 events are constrained to safe/neutral defaults (plan §7).
    const leaderCharId = await getHeadOfGovernmentCharacterId(db, countryId);
    if (leaderCharId) {
      const leaderChar = await db
        .collection<Character>("characters")
        .findOne({ _id: leaderCharId }, { projection: { userId: 1 } });
      if (leaderChar?.userId) {
        await notifyCountryExecutiveEventOffered(leaderChar.userId, definition, instance);
      }
    }

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
