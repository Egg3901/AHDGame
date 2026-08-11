import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Character, User } from "@/lib/db/types";
import { ObjectId } from "mongodb";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { getOfficeLabel } from "@/lib/utils/politics";

// GET /api/characters/search — Search characters by name with optional party, country, and exclude filters
// Auth: public
// Errors: 400
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const limitParam = parseInt(searchParams.get("limit") || "3", 10);
    const limit = Math.min(isNaN(limitParam) ? 3 : limitParam, 10);
    const party = searchParams.get("party");
    const countryId = searchParams.get("countryId");
    const excludeParam = searchParams.get("exclude");
    const exclude = excludeParam
      ? excludeParam.split(",").filter((id) => ObjectId.isValid(id))
      : [];

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const db = await getDb();
    const escaped = escapeRegex(query);

    // Build query
    const mongoQuery: Record<string, unknown> = {
      name: { $regex: escaped, $options: "i" },
    };

    if (party) {
      mongoQuery.party = party;
    }

    if (countryId) {
      mongoQuery.countryId = countryId;
    }

    if (exclude.length > 0) {
      mongoQuery._id = { $nin: exclude.map((id) => new ObjectId(id)) };
    }

    // Search characters by name AND look up users by username / discordUsername
    const [characters, userMatches] = await Promise.all([
      db
        .collection<Character>("characters")
        .find(mongoQuery)
        .limit(limit)
        .sort({ name: 1 })
        .toArray(),
      db
        .collection<User>("users")
        .find({
          $or: [
            { username: { $regex: escaped, $options: "i" } },
            { discordUsername: { $regex: escaped, $options: "i" } },
          ],
        })
        .toArray(),
    ]);

    // Find characters belonging to matched users (excluding those already found by name)
    const matchedUserIds = userMatches.filter((u) => !u.isBanned).map((u) => u._id);
    const foundCharIds = new Set(characters.map((c) => c._id.toString()));
    let userLinkedCharacters: Character[] = [];
    if (matchedUserIds.length > 0) {
      userLinkedCharacters = await db
        .collection<Character>("characters")
        .find({ userId: { $in: matchedUserIds } })
        .limit(limit)
        .toArray();
    }

    // Combine and deduplicate
    const allCharacters = [...characters];
    for (const c of userLinkedCharacters) {
      if (!foundCharIds.has(c._id.toString())) {
        allCharacters.push(c);
        foundCharIds.add(c._id.toString());
        if (allCharacters.length >= limit) break;
      }
    }

    // Build a lookup for username + discordUsername from matched users
    const allUserIds = allCharacters.map((c) => c.userId).filter(Boolean);
    const allUsers =
      allUserIds.length > 0
        ? await db
            .collection<User>("users")
            .find({ _id: { $in: allUserIds } })
            .toArray()
        : [];
    const userMap = new Map(allUsers.map((u) => [u._id.toString(), u]));
    const bannedUserIds = new Set(allUsers.filter((u) => u.isBanned).map((u) => u._id.toString()));

    const results = allCharacters
      .filter((c) => !bannedUserIds.has(c.userId?.toString() ?? ""))
      .map((char) => {
        const user = char.userId ? userMap.get(char.userId.toString()) : null;
        return {
          id: char._id.toString(),
          userId: char.userId?.toString() ?? null,
          name: char.name,
          username: user?.username ?? null,
          discordUsername: user?.discordUsername ?? null,
          party: char.party,
          homeState: char.homeState,
          avatarUrl: char.avatarUrl,
          currentOffice: char.currentOffice ? getOfficeLabel(char.currentOffice) : null,
        };
      });

    return NextResponse.json({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
