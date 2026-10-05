import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Character } from "@/lib/db/types";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const patchSchema = z.object({
  highlightedAchievementIds: z
    .array(z.string().refine((s) => ObjectId.isValid(s), "Invalid ObjectId"))
    .max(5)
    .optional(),
});

// PATCH /api/settings/achievements — Updates the authenticated character's highlighted achievement IDs (max 5, must be earned)
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const { highlightedAchievementIds } = parsed.data;
    if (!highlightedAchievementIds) {
      return errorResponse(400, "highlightedAchievementIds required");
    }

    const db = await getDb();

    const character = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(user.userId),
    });
    if (!character) {
      return errorResponse(403, "Character not found");
    }

    if (highlightedAchievementIds.length > 5) {
      return errorResponse(400, "Maximum 5 achievements can be highlighted");
    }

    const earnedIds = await db
      .collection("characterAchievements")
      .find({ characterId: character._id })
      .project({ achievementId: 1 })
      .toArray();
    const earnedSet = new Set(earnedIds.map((e) => e.achievementId.toString()));

    const validIds: ObjectId[] = [];
    for (const idStr of highlightedAchievementIds) {
      if (!earnedSet.has(idStr)) {
        return errorResponse(400, `Achievement ${idStr} is not earned by this character`);
      }
      validIds.push(new ObjectId(idStr));
    }

    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: character._id },
        { $set: { highlightedAchievementIds: validIds, updatedAt: new Date() } }
      );

    return NextResponse.json({
      success: true,
      highlightedAchievementIds: validIds.map((id) => id.toString()),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
