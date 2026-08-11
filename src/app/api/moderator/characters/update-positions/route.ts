import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { createModAuditLog } from "@/lib/modAuditLog";
import { z } from "zod";
import type { Character } from "@/lib/db/types";

const positionValue = z.number().int().min(-5).max(5);

const updatePositionsSchema = z.object({
  characterId: z.string().refine((v) => ObjectId.isValid(v), "Invalid characterId"),
  economic: positionValue.optional(),
  social: positionValue.optional(),
});

// PATCH /api/moderator/characters/update-positions — Update a character's economic and social policy positions.
// Auth: requireModerator
// Errors: 400, 403, 404
export async function PATCH(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const parsed = await parseJsonBody(request, updatePositionsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId, economic, social } = parsed.data;

    if (economic === undefined && social === undefined) {
      return NextResponse.json(
        { error: "At least one of economic or social must be provided" },
        { status: 400 }
      );
    }

    const db = await getDb();

    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(characterId) });
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    // Resolve the linked account for the admin-account guard and audit-log
    // attribution (NPCs may have no linked user).
    const user = character.userId
      ? await db.collection("users").findOne({ _id: character.userId })
      : null;
    if (user?.role === "admin") {
      return NextResponse.json(
        { error: "Cannot perform actions on admin accounts" },
        { status: 403 }
      );
    }

    const oldEconomic = character.policies.economic;
    const oldSocial = character.policies.social;

    const nextEconomic = economic !== undefined ? economic : oldEconomic;
    const nextSocial = social !== undefined ? social : oldSocial;

    if (oldEconomic === nextEconomic && oldSocial === nextSocial) {
      return NextResponse.json({
        success: true,
        message: `${character.name}'s positions are already set to economic ${nextEconomic}, social ${nextSocial} — no change made`,
      });
    }

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (economic !== undefined) $set["policies.economic"] = economic;
    if (social !== undefined) $set["policies.social"] = social;

    await db.collection<Character>("characters").updateOne({ _id: character._id }, { $set });

    const detailsParts: string[] = [];
    if (economic !== undefined) detailsParts.push(`economic ${oldEconomic} → ${economic}`);
    if (social !== undefined) detailsParts.push(`social ${oldSocial} → ${social}`);

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "update_character_positions",
      targetUserId: user?._id.toString() ?? character.userId?.toString(),
      targetUsername: user?.username ?? character.name,
      details: `Updated ${character.name}'s positions: ${detailsParts.join(", ")}`,
    });

    return NextResponse.json({
      success: true,
      message: `${character.name}'s positions updated`,
      character: {
        name: character.name,
        oldEconomic,
        newEconomic: nextEconomic,
        oldSocial,
        newSocial: nextSocial,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
