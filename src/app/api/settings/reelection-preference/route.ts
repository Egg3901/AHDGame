import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { autoRunForReelectionSchema } from "@/lib/api/schemas/settings";
import type { Character } from "@/lib/db/types";

// PATCH /api/settings/reelection-preference — Updates the authenticated character's auto-run-for-reelection preference
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, autoRunForReelectionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { autoRunForReelection } = parsed.data;

    const db = await getDb();
    const userObjectId = new ObjectId(user.userId);
    const userDoc = await db
      .collection("users")
      .findOne({ _id: userObjectId }, { projection: { activeCharacterId: 1 } });

    const character = await db
      .collection<Character>("characters")
      .findOne(
        userDoc?.activeCharacterId
          ? { _id: userDoc.activeCharacterId, userId: userObjectId }
          : { userId: userObjectId }
      );

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    await db
      .collection<Character>("characters")
      .updateOne({ _id: character._id }, { $set: { autoRunForReelection } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
