import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  getAccountAchievements,
  getAchievementRarityMap,
  getAllAchievements,
} from "@/lib/achievements";
import type { Character } from "@/lib/db/types";
import { handleRouteError } from "@/lib/api/errors";
import { getAchievementProgress } from "@/lib/achievements/progress";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/characters/[id]/achievements
 * Returns character's earned achievements with rarity percentages.
 */
// GET /api/characters/[id]/achievements — Returns a character's earned achievements with rarity percentages
// Auth: public
// Errors: 400, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const characterId = new ObjectId(id);
    const db = await getDb();

    const character = await db.collection<Character>("characters").findOne({ _id: characterId });
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const [earned, rarityMap, allAchievements] = await Promise.all([
      getAccountAchievements(character.userId),
      getAchievementRarityMap(),
      getAllAchievements(),
    ]);

    const highlights = character.highlightedAchievementIds ?? [];
    const highlightSet = new Set(highlights.map((h) => h.toString()));

    const items = earned.map(({ achievement, earnedAt }) => ({
      id: achievement._id.toString(),
      slug: achievement.slug,
      name: achievement.name,
      description: achievement.description,
      icon: achievement.icon,
      category: achievement.category,
      earnedAt: earnedAt.toISOString(),
      rarity: rarityMap.get(achievement._id.toString()) ?? 0,
      isHighlighted: highlightSet.has(achievement._id.toString()),
    }));

    const highlightedItems = items.filter((i) => i.isHighlighted);
    const highlightedOrder = highlights.map((h) => h.toString());
    const sortedHighlights = highlightedOrder
      .map((hid) => highlightedItems.find((i) => i.id === hid))
      .filter((x): x is NonNullable<(typeof items)[number]> => Boolean(x));

    const earnedIds = new Set(earned.map(({ achievement }) => achievement._id.toString()));
    const progressEntries = await Promise.all(
      allAchievements.map(
        async (a) =>
          [
            a._id.toString(),
            earnedIds.has(a._id.toString()) ? null : await getAchievementProgress(db, character, a),
          ] as const
      )
    );
    const progressMap = new Map(progressEntries);

    const allItems = allAchievements.map((a) => {
      const earnedEntry = earned.find(
        ({ achievement }) => achievement._id.toString() === a._id.toString()
      );
      return {
        id: a._id.toString(),
        slug: a.slug,
        name: a.name,
        description: a.description,
        icon: a.icon,
        category: a.category,
        isHidden: a.isHidden,
        order: a.order,
        earned: !!earnedEntry,
        earnedAt: earnedEntry ? earnedEntry.earnedAt.toISOString() : null,
        rarity: rarityMap.get(a._id.toString()) ?? 0,
        isHighlighted: highlightSet.has(a._id.toString()),
        progress: progressMap.get(a._id.toString()) ?? null,
      };
    });

    return NextResponse.json({
      achievements: items,
      highlighted: sortedHighlights,
      allAchievements: allItems,
      totalEarned: items.length,
      totalAchievements: allAchievements.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
