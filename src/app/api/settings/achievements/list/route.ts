import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getAccountAchievements, getAchievementRarityMap } from "@/lib/achievements";

// GET /api/settings/achievements/list — Returns account-level achievements (no character required)
// Auth: requireBasicAuth
// Errors: 401
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const userId = new ObjectId(auth.user.userId);

    const [earned, rarityMap] = await Promise.all([
      getAccountAchievements(userId),
      getAchievementRarityMap(),
    ]);

    const items = earned.map(({ achievement, earnedAt }) => ({
      id: achievement._id.toString(),
      slug: achievement.slug,
      name: achievement.name,
      description: achievement.description,
      icon: achievement.icon,
      category: achievement.category,
      earnedAt: earnedAt.toISOString(),
      rarity: rarityMap.get(achievement._id.toString()) ?? 0,
    }));

    return NextResponse.json({
      achievements: items,
      totalEarned: items.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
