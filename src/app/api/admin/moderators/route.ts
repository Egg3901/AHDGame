import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { parseBoundedIntParam } from "@/lib/api/validate";
import type { User } from "@/lib/db/types";

// GET /api/admin/moderators — List users with moderator role.
// Auth: requireAdmin
// Query: ?limit (default 100, max 500), ?offset (default 0)
// Errors: 403
export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseBoundedIntParam(searchParams, "limit", 100, 1, 500);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

    const db = await getDb();
    const [moderators, total] = await Promise.all([
      db
        .collection<User>("users")
        .find({ role: "moderator" })
        .sort({ moderatorSince: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection<User>("users").countDocuments({ role: "moderator" }),
    ]);

    const characterIds = moderators
      .filter((m) => m.activeCharacterId)
      .map((m) => m.activeCharacterId!);

    const characters = characterIds.length
      ? await db
          .collection("characters")
          .find({ _id: { $in: characterIds } })
          .toArray()
      : [];

    const charMap = new Map(characters.map((c) => [c._id.toString(), c]));

    return NextResponse.json({
      moderators: moderators.map((m) => ({
        userId: m._id.toString(),
        username: m.username,
        email: m.email,
        moderatorSince: m.moderatorSince ?? m.updatedAt,
        characterName: m.activeCharacterId
          ? (charMap.get(m.activeCharacterId.toString())?.name ?? null)
          : null,
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
