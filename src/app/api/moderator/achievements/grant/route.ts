import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createModAuditLog } from "@/lib/modAuditLog";
import { z } from "zod";
import type { Character } from "@/lib/db/types";
import { awardAchievement } from "@/lib/achievements";

const grantSchema = z.object({
  characterId: z.string().refine((s) => ObjectId.isValid(s), "Invalid character ID"),
  achievementSlug: z.string().min(1),
});

// POST /api/moderator/achievements/grant — Grant achievement to a character.
// Auth: requireModerator
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const parsed = await parseJsonBody(request, grantSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { characterId, achievementSlug } = parsed.data;
    const db = await getDb();

    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(characterId) });
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const achievement = await db.collection("achievements").findOne({ slug: achievementSlug });
    if (!achievement) {
      return NextResponse.json({ error: "Achievement not found" }, { status: 404 });
    }

    const granted = await awardAchievement(
      character.userId,
      achievementSlug,
      new ObjectId(characterId),
      moderator.character?._id
    );

    if (granted) {
      await createModAuditLog({
        moderatorId: moderator.userId,
        moderatorName: moderator.username,
        action: "grant_achievement",
        targetUserId: character.userId.toString(),
        details: `Granted achievement "${achievementSlug}" to ${character.name}`,
      });
    }

    return NextResponse.json({
      success: true,
      granted,
      message: granted
        ? `Achievement "${achievementSlug}" granted to ${character.name}.`
        : "Character already had this achievement.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
