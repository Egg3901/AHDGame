import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";

export interface LeaderboardEntry {
  characterId: string;
  sequentialId: number | null;
  characterName: string;
  avatarUrl?: string;
  party: string;
  homeState: string;
  subscriberCount: number;
  totalLikes: number;
  postCount: number;
  borderKey?: string | null;
  tintColor?: string | null;
}

// GET /api/news/leaderboard — Return all news authors ranked by subscriber count and total likes.
// Auth: public
// Errors: (none)
// GET /api/news/leaderboard — top authors by subscribers or total likes
export async function GET() {
  try {
    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    const enabledCountries = isAdmin ? undefined : await getEnabledCountryIds();

    const db = await getDb();

    // Aggregate news post stats per author (top-level posts only)
    const postStats = await db
      .collection("newsPosts")
      .aggregate<{ _id: string; totalLikes: number; postCount: number }>([
        {
          $match: {
            parentId: { $exists: false },
            isSystem: { $ne: true },
            feedType: { $ne: "advertisement" },
          },
        },
        {
          $group: {
            _id: { $toString: "$authorId" },
            totalLikes: { $sum: "$reactions.agree" },
            postCount: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const statsMap = new Map(
      postStats.map((s) => [s._id, { totalLikes: s.totalLikes, postCount: s.postCount }])
    );

    // Aggregate subscriber counts per character
    const subStats = await db
      .collection("userSubscriptions")
      .aggregate<{ _id: string; subscriberCount: number }>([
        {
          $group: {
            _id: { $toString: "$subscribedToCharacterId" },
            subscriberCount: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const subMap = new Map(subStats.map((s) => [s._id, s.subscriberCount]));

    // Collect all unique characterIds that appear in either map
    const allIds = new Set([...statsMap.keys(), ...subMap.keys()]);

    if (allIds.size === 0) {
      return NextResponse.json({ entries: [] });
    }

    const { ObjectId } = await import("mongodb");
    const objectIds = [...allIds]
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const characterFilter: Record<string, unknown> = { _id: { $in: objectIds } };
    if (enabledCountries !== undefined) {
      characterFilter.countryId = { $in: enabledCountries };
    }

    const characters = await db.collection("characters").find(characterFilter).toArray();

    const userIds = characters.map((c) => c.userId).filter(Boolean);
    const borderMap = await fetchBordersByUserIds(db, userIds);

    const entries: LeaderboardEntry[] = characters.map((char) => {
      const cid = char._id.toString();
      const stats = statsMap.get(cid) ?? { totalLikes: 0, postCount: 0 };
      const border = char.userId ? borderMap.get(char.userId.toString()) : undefined;
      return {
        characterId: cid,
        sequentialId: (char.sequentialId as number | undefined) ?? null,
        characterName: char.name as string,
        avatarUrl: char.avatarUrl as string | undefined,
        party: char.party as string,
        homeState: char.homeState as string,
        subscriberCount: subMap.get(cid) ?? 0,
        totalLikes: stats.totalLikes,
        postCount: stats.postCount,
        borderKey: border?.borderKey ?? null,
        tintColor: border?.tintColor ?? null,
      };
    });

    // Return all entries (frontend will sort). Global leaderboard (no per-user
    // fields); cache at the edge instead of recomputing two full-collection
    // $group aggregations per request. (#2818)
    return NextResponse.json(
      { entries },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60, no-transform",
        },
      }
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
