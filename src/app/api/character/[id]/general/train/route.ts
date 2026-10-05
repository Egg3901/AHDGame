// POST /api/character/[id]/general/train
// Train a trait node on a character's general. Auth: self or admin. Gated by
// conflictsEnabled. The server re-validates points/availability/era via trainNode.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import {
  getCharacterCommission,
  getCharacterGeneralsCollection,
} from "@/lib/db/collections/characterGenerals";
import { trainNode } from "@/lib/military/generalsTree";
import { resolveGeneralEra } from "@/lib/military/currentGeneralEra";
import { parseCharacterId } from "@/lib/utils/profileUrls";
import type { Character } from "@/lib/db/types";

const bodySchema = z.object({ nodeId: z.string().min(1) });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const parsed = parseCharacterId(id);
    if (!parsed) return errorResponse(400, "Invalid character ID");

    const body = await parseJsonBody(request, bodySchema);
    if (!body.success) return errorResponse(body.status, body.error);

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return errorResponse(404, "Conflicts subsystem disabled");
    }

    const character = await db
      .collection<Character>("characters")
      .findOne(
        parsed.type === "sequential"
          ? { sequentialId: parsed.value }
          : { _id: new ObjectId(parsed.value) }
      );
    if (!character) return errorResponse(404, "Character not found");

    const charId = character._id.toString();
    const isSelf = auth.user.character && auth.user.character._id.toString() === charId;
    if (!isSelf && !auth.user.isAdmin) {
      return errorResponse(403, "Not your character");
    }

    // Gate on the commission, not merely a profile: a dismissed general keeps their
    // retained record, but a dismissed officer may not go on training.
    const commission = await getCharacterCommission(db, charId);
    if (!commission.commissioned || !commission.general) {
      return errorResponse(403, "Not a commissioned general");
    }
    const general = commission.general;

    const curEra = await resolveGeneralEra(db);
    const res = trainNode(general, body.data.nodeId, curEra);
    if (!res.changed) {
      return errorResponse(400, res.reason ?? "Cannot train");
    }

    await getCharacterGeneralsCollection(db).updateOne(
      { characterId: charId },
      { $set: { general: res.general } }
    );
    return NextResponse.json({ general: res.general });
  } catch (error) {
    return handleRouteError(error);
  }
}
