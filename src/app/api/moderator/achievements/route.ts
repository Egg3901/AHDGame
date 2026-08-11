import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { getAllAchievements } from "@/lib/achievements";

// GET /api/moderator/achievements — Lists all achievements with earned counts.
// Auth: requireModerator
// Errors: 403
export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const achievements = await getAllAchievements();
    const db = await getDb();

    const counts = await db
      .collection("characterAchievements")
      .aggregate<{ _id: ObjectId; count: number }>([
        { $group: { _id: "$achievementId", count: { $sum: 1 } } },
      ])
      .toArray();
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    const list = achievements.map((a) => ({
      id: a._id.toString(),
      slug: a.slug,
      name: a.name,
      description: a.description,
      icon: a.icon,
      category: a.category,
      triggerType: a.triggerType,
      order: a.order,
      earnedCount: countMap.get(a._id.toString()) ?? 0,
    }));

    return NextResponse.json({ achievements: list });
  } catch (error) {
    return handleRouteError(error);
  }
}
