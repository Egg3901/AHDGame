import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Character, User } from "@/lib/db/types";

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() ?? "";
    if (!q) {
      return NextResponse.json({ users: [] });
    }

    const regex = new RegExp(escapeRegex(q), "i");
    const db = await getDb();

    const [users, characters] = await Promise.all([
      db.collection<User>("users").find({ username: regex }).limit(10).toArray(),
      db.collection<Character>("characters").find({ name: regex }).limit(10).toArray(),
    ]);

    const userIdsFromCharacters = characters.map((character) => character.userId);
    const characterUsers =
      userIdsFromCharacters.length > 0
        ? await db
            .collection<User>("users")
            .find({
              _id: { $in: userIdsFromCharacters },
            })
            .toArray()
        : [];

    const usersById = new Map<string, User>();
    for (const user of [...users, ...characterUsers]) {
      usersById.set(user._id.toString(), user);
    }

    const primaryCharacterByUserId = new Map<string, Character>();
    for (const character of characters) {
      primaryCharacterByUserId.set(character.userId.toString(), character);
    }

    const result = Array.from(usersById.values()).map((user) => ({
      userId: user._id.toString(),
      username: user.username,
      characterName: primaryCharacterByUserId.get(user._id.toString())?.name ?? null,
      patreonTier: user.patreonTier ?? null,
      patreonExpiresAt: user.patreonExpiresAt ?? null,
      patreonUserId: user.patreonUserId ?? null,
    }));

    return NextResponse.json({ users: result });
  } catch (error) {
    return handleRouteError(error);
  }
}
