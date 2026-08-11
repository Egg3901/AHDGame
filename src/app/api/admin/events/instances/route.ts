import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import "@/lib/events/pree/index";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { badRequest, handleRouteError } from "@/lib/api/errors";
import { getEventCooldownLedgerCollection } from "@/lib/db/collections/eventCooldownLedger";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { getEventInstancesCollection } from "@/lib/db/collections/eventInstances";
import { getEventHandler } from "@/lib/events/substrate/registry";

// GET /api/admin/events/instances?characterId=... - Event history for a character (debugger).
// Auth: requireAdmin
// Errors: 400, 401, 403
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const characterId = url.searchParams.get("characterId");
    if (!characterId || !ObjectId.isValid(characterId)) {
      throw badRequest("Invalid characterId");
    }

    const db = await getDb();
    const scopeId = new ObjectId(characterId);
    const [instances, ledger] = await Promise.all([
      getEventInstancesCollection(db)
        .find({ scope: "character", scopeId })
        .sort({ offeredAt: -1 })
        .limit(50)
        .toArray(),
      getEventCooldownLedgerCollection(db).findOne({ scope: "character", scopeId }),
    ]);

    const kinds = [...new Set(instances.map((i) => i.kind))];
    const definitions = kinds.length
      ? await getEventDefinitionsCollection(db)
          .find({ kind: { $in: kinds } })
          .toArray()
      : [];
    const definitionByKind = new Map(definitions.map((d) => [d.kind, d]));

    const items = instances.map((instance) => {
      const definition = definitionByKind.get(instance.kind);
      const handler = getEventHandler(instance.kind);
      const optionLabel = (optionId: string | undefined) => {
        if (!optionId) return null;
        return (
          definition?.options.find((o) => o.id === optionId)?.label ??
          handler?.options.find((o) => o.id === optionId)?.label ??
          optionId
        );
      };
      return {
        instanceId: instance._id.toHexString(),
        kind: instance.kind,
        title: definition?.title ?? instance.kind,
        status: instance.status,
        roll: instance.roll,
        offeredAtTurn: instance.offeredAtTurn,
        offeredAt: instance.offeredAt,
        expiresAtRealtimeMs: instance.expiresAtRealtimeMs,
        resolvedAt: instance.resolvedAt ?? null,
        resolvedOptionId: instance.resolvedOptionId ?? null,
        resolvedOptionLabel: optionLabel(instance.resolvedOptionId),
        resolvedTierLabel: instance.resolvedTierLabel ?? null,
        resolveReason: instance.resolveReason ?? null,
      };
    });

    return NextResponse.json({
      items,
      cooldown: ledger
        ? {
            lastExpiredAtTurn: ledger.lastExpiredAtTurn,
            nextEligibleTurn: ledger.nextEligibleTurn,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
