// POST /api/country/[code]/executive/cabinet/[positionId]/generals
// The Secretary of Defense commissions a character into the general corps. A fresh
// commission gets a level-1 profile; the appointee's specialisation then derives from
// the trait tree they train. Re-appointing a dismissed veteran restores their retained
// record. Auth: defense holder or admin. Gated by conflictsEnabled + defense seat.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getCharacterGeneralsCollection } from "@/lib/db/collections/characterGenerals";
import { isCommissioned } from "@/lib/db/types/characterGeneral";
import { newGeneral } from "@/lib/military/generalsTree";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import type { Character } from "@/lib/db/types";

const bodySchema = z.object({ characterId: z.string().min(1) });

function chopFor(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[p.length - 1]?.[0] ?? "")).toUpperCase() || "GN";
}

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return errorResponse(404, "Not a defense cabinet position");
    }

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, currentTurn: 1 } });
    if (!gs?.conflictsEnabled) {
      return errorResponse(404, "Conflicts subsystem disabled");
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the defence minister may commission generals.");
    }

    // A commission stands until revoked, long past this tenure.
    const actingDenied = requireConfirmedSecretary(member, "personnel", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { characterId } = parsed.data;
    // A malformed id is a bad request, not a crash — `new ObjectId` throws on one.
    if (!ObjectId.isValid(characterId)) {
      return errorResponse(400, "Invalid character ID");
    }

    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(characterId) as never });
    if (!character) return errorResponse(404, "Character not found");
    // A defense minister commissions their own country's officers.
    if (character.countryId !== countryId) {
      return errorResponse(400, "Character is not of this country");
    }

    const existing = await getCharacterGeneralsCollection(db).findOne({ characterId });
    if (existing && isCommissioned(existing)) {
      return errorResponse(400, "Already commissioned");
    }

    // `general` is set on insert alone: a first commission gets a fresh level-1
    // profile, while re-appointing a dismissed veteran leaves their retained record
    // (level, xp, trained nodes) untouched. Specialisation is not set here — it
    // derives from the tree they go on to train.
    await getCharacterGeneralsCollection(db).updateOne(
      { characterId },
      {
        $set: {
          commissioned: true,
          commissionedByCharacterId: auth.user.character?._id?.toString(),
          commissionedTurn: gs.currentTurn ?? 0,
        },
        $unset: { dismissedTurn: "" },
        $setOnInsert: {
          characterId,
          general: newGeneral(characterId, character.name, chopFor(character.name), countryId),
        },
      },
      { upsert: true }
    );
    return NextResponse.json({ ok: true, restored: Boolean(existing?.general) });
  } catch (error) {
    return handleRouteError(error);
  }
}
