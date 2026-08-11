import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character, CharacterAchievement, User } from "@/lib/db/types";
import { handleRouteError } from "@/lib/api/errors";

interface RouteParams {
  params: Promise<{ achievementId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { achievementId } = await params;
    if (!ObjectId.isValid(achievementId)) {
      return NextResponse.json({ error: "Invalid achievement ID" }, { status: 400 });
    }
    const db = await getDb();
    const awards = await db
      .collection<CharacterAchievement>("characterAchievements")
      .find({ achievementId: new ObjectId(achievementId) })
      .sort({ earnedAt: -1 })
      .limit(5)
      .toArray();
    const userIds = awards.map((award) => award.userId);
    const characterIds = awards.flatMap((award) => (award.characterId ? [award.characterId] : []));
    const [users, characters] = await Promise.all([
      db
        .collection<User>("users")
        .find({ _id: { $in: userIds } })
        .toArray(),
      db
        .collection<Character>("characters")
        .find({ _id: { $in: characterIds } })
        .toArray(),
    ]);
    const userNames = new Map(
      users.map((user) => [user._id.toString(), user.displayName || user.username])
    );
    const characterNames = new Map(
      characters.map((character) => [character._id.toString(), character.name])
    );

    return NextResponse.json({
      holders: awards.map((award) => ({
        name:
          (award.characterId && characterNames.get(award.characterId.toString())) ??
          userNames.get(award.userId.toString()) ??
          "Player",
        earnedAt: award.earnedAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
