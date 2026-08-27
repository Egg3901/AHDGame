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
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { assertActingAllowed } from "@/lib/cabinet/actingScope";
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
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 });
    }

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, currentTurn: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the defence minister may commission generals." },
        { status: 403 }
      );
    }

    const actingCheck = assertActingAllowed(member, "personnel", {
      isAdmin: auth.user.isAdmin === true,
    });
    if (!actingCheck.ok) return actingCheck.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId } = parsed.data;
    // A malformed id is a bad request, not a crash — `new ObjectId` throws on one.
    if (!ObjectId.isValid(characterId)) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(characterId) as never });
    if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });
    // A defense minister commissions their own country's officers.
    if (character.countryId !== countryId) {
      return NextResponse.json({ error: "Character is not of this country" }, { status: 400 });
    }

    const existing = await getCharacterGeneralsCollection(db).findOne({ characterId });
    if (existing && isCommissioned(existing)) {
      return NextResponse.json({ error: "Already commissioned" }, { status: 400 });
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
