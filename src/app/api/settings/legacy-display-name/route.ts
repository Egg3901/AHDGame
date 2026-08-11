import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { badRequest, handleRouteError } from "@/lib/api/errors";
import type { Character } from "@/lib/db/types/character";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";

const schema = z.object({ characterId: z.string().nullable() });

// PATCH /api/settings/legacy-display-name - Sets which life's name shows on the Hall of Fame leaderboard.
// Auth: requireAuth
// Errors: 400, 401
export async function PATCH(request: Request) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { characterId } = parsed.data;
    const userId = new ObjectId(auth.user.userId);
    const db = await getDb();

    if (characterId !== null && characterId !== "current") {
      if (!ObjectId.isValid(characterId)) throw badRequest("Invalid characterId");
      const objectId = new ObjectId(characterId);
      const [ownsActive, ownsRetired] = await Promise.all([
        db
          .collection<Character>("characters")
          .findOne({ _id: objectId, userId }, { projection: { _id: 1 } }),
        db
          .collection<RetiredCharacter>("retiredCharacters")
          .findOne({ characterId: objectId, userId }, { projection: { _id: 1 } }),
      ]);
      if (!ownsActive && !ownsRetired) throw badRequest("That life does not belong to you");
    }

    await db
      .collection("users")
      .updateOne(
        { _id: userId },
        characterId === null
          ? { $unset: { legacyDisplayCharacterId: "" } }
          : { $set: { legacyDisplayCharacterId: characterId } }
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
