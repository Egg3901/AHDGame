import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { displayCurrencyPreferenceSchema } from "@/lib/api/schemas/settings";
import type { User } from "@/lib/db/types";

// PATCH /api/settings/display-currency — Saves the player's currency display preference to their
// active regular or imperial character, matching the currently selected mode.
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, displayCurrencyPreferenceSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { displayCurrencyPreference } = parsed.data;

    const db = await getDb();
    const userDoc = await db.collection<User>("users").findOne(
      { _id: new ObjectId(auth.user.userId) },
      {
        projection: {
          activeCharacterId: 1,
          activeCharacterType: 1,
          activeImperialCharacterId: 1,
        },
      }
    );
    if (!userDoc) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const update = { $set: { displayCurrencyPreference, updatedAt: new Date() } };
    let matchedCount = 0;
    if (userDoc.activeCharacterType === "imperial" && userDoc.activeImperialCharacterId) {
      const result = await db
        .collection("imperialCharacters")
        .updateOne(
          { _id: userDoc.activeImperialCharacterId, userId: new ObjectId(auth.user.userId) },
          update
        );
      matchedCount = result.matchedCount ?? 0;
    } else {
      const characterFilter = userDoc.activeCharacterId
        ? { _id: userDoc.activeCharacterId, userId: new ObjectId(auth.user.userId) }
        : { userId: new ObjectId(auth.user.userId) };
      const result = await db.collection("characters").updateOne(characterFilter, update);
      matchedCount = result.matchedCount ?? 0;
    }

    if (matchedCount === 0) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
