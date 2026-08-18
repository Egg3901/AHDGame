// GET — Fetch retired characters for a given user
// POST — Admin retires a user's active character
// Auth: requireAdmin
// Errors: 403, 404

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { retireCharacter } from "@/lib/retireCharacter";
import { buildRetireRecapOpts } from "@/lib/recap/retireRecapOpts";
import type { Character } from "@/lib/db/types";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import { ObjectId } from "mongodb";
import { z } from "zod";

// GET /api/admin/users/retire-character?userId=xxx — Fetch retired characters for a user.
// Auth: requireAdmin
// Errors: 400, 403
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get("userId");
    if (!userIdParam || !/^[a-f\d]{24}$/i.test(userIdParam)) {
      return NextResponse.json({ error: "Valid userId query param required" }, { status: 400 });
    }

    const db = await getDb();
    const retired = await db
      .collection<RetiredCharacter>("retiredCharacters")
      .find({ userId: new ObjectId(userIdParam) })
      .sort({ retiredAt: -1 })
      .toArray();

    return NextResponse.json({
      retiredCharacters: retired.map((r) => ({
        id: r._id.toString(),
        characterId: r.characterId.toString(),
        retiredAt: r.retiredAt.toISOString(),
        reason: r.reason,
        name: r.snapshot.name,
        party: r.snapshot.party,
        highestOffice: r.snapshot.highestOffice,
        achievementCount: r.snapshot.achievementCount,
        countryId: r.snapshot.countryId,
        homeState: r.snapshot.homeState,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const schema = z.object({
  userId: schemas.objectId,
});

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const userId = new ObjectId(parsed.data.userId);

    const user = await db.collection("users").findOne({ _id: userId });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Find active character — use activeCharacterId if set, otherwise first character
    const charQuery = user.activeCharacterId ? { _id: user.activeCharacterId, userId } : { userId };
    const character = await db.collection<Character>("characters").findOne(charQuery);
    if (!character)
      return NextResponse.json({ error: "User has no active character" }, { status: 404 });

    const recapOpts = await buildRetireRecapOpts(db, character);
    await retireCharacter(db, character, userId, "admin_action", recapOpts);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
