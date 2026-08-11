import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import type { Character, User, Achievement, CharacterAchievement } from "@/lib/db/types";

// GET /api/discord-bot/achievements — Returns a character's earned achievements, looked up by characterId, discordId, or name.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:achievements",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const characterId = url.searchParams.get("characterId");
    const discordId = url.searchParams.get("discordId");
    const name = url.searchParams.get("name");

    if (!characterId && !discordId && !name) {
      return NextResponse.json(
        { error: "Must provide characterId, discordId, or name" },
        { status: 400 }
      );
    }

    const db = await getDb();

    let character: Character | null = null;

    if (characterId && ObjectId.isValid(characterId)) {
      character = await db
        .collection<Character>("characters")
        .findOne({ _id: new ObjectId(characterId) });
    } else if (discordId) {
      const user = await db.collection<User>("users").findOne({ discordId });
      if (user) {
        character = await db.collection<Character>("characters").findOne({ userId: user._id });
      }
    } else if (name) {
      character = await db
        .collection<Character>("characters")
        .findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } });
    }

    if (!character) {
      return NextResponse.json({ found: false, achievements: [] });
    }

    const earned = await db
      .collection<CharacterAchievement>("characterAchievements")
      .find({ characterId: character._id })
      .sort({ earnedAt: -1 })
      .toArray();

    if (earned.length === 0) {
      return NextResponse.json({
        found: true,
        characterId: character._id.toString(),
        characterName: character.name,
        achievements: [],
      });
    }

    const achievementIds = earned.map((e) => e.achievementId);
    const definitions = await db
      .collection<Achievement>("achievements")
      .find({ _id: { $in: achievementIds } })
      .toArray();

    const defMap = new Map(definitions.map((d) => [d._id.toString(), d]));

    const highlightedIds = new Set(
      (character.highlightedAchievementIds ?? []).map((id) => id.toString())
    );

    const achievements = earned.map((e) => {
      const def = defMap.get(e.achievementId.toString());
      return {
        id: e.achievementId.toString(),
        name: def?.name ?? "Unknown",
        description: def?.description ?? "",
        icon: def?.icon ?? "",
        category: def?.category ?? "special",
        isHidden: def?.isHidden ?? false,
        isHighlighted: highlightedIds.has(e.achievementId.toString()),
        earnedAt: e.earnedAt instanceof Date ? e.earnedAt.toISOString() : e.earnedAt,
      };
    });

    return NextResponse.json({
      found: true,
      characterId: character._id.toString(),
      characterName: character.name,
      achievements,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
