import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { Character } from "@/lib/db/types";
import { revokeAchievement } from "@/lib/achievements";

const revokeSchema = z.object({
  characterId: z.string().refine((s) => ObjectId.isValid(s), "Invalid character ID"),
  achievementSlug: z.string().min(1),
});

// POST /api/admin/achievements/revoke — Revokes a specified achievement from a single character.
// Auth: requireAdmin
// Errors: 400, 403, 404
export const POST = withAdminAuth(async (_auth, request: Request) => {
  try {
    const parsed = await parseJsonBody(request, revokeSchema);
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

    const revoked = await revokeAchievement(character.userId, achievementSlug);

    if (!revoked) {
      return NextResponse.json(
        { error: "Character does not have this achievement" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Achievement "${achievementSlug}" revoked from ${character.name}.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
