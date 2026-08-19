import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Character } from "@/lib/db/types";
import { awardAchievement } from "@/lib/achievements";

const grantSchema = z.object({
  characterId: z.string().refine((s) => ObjectId.isValid(s), "Invalid character ID"),
  achievementSlug: z.string().min(1),
});

// POST /api/admin/achievements/grant — Grants a specified achievement to a single character by ID.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

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
      auth.admin.character?._id
    );

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
