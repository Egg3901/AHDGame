import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { getLegacyLeaderboardData } from "@/lib/world/legacyLeaderboard";
import type { LegacyLeaderboardScope, LegacyRankBy } from "@/lib/world/legacyLeaderboardTypes";

// GET /api/v1/leaderboard/legacy - Cross-iteration Hall of Fame: every player ranked by their single best-scoring life ever played. ?scope=all|current&rankBy=legacy|netWorth
// Auth: public (includes the caller's own rank/lives when signed in)
// Errors: (none)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 200);
    const scopeParam = url.searchParams.get("scope");
    const scope: LegacyLeaderboardScope = scopeParam === "current" ? "current" : "all";
    const rankByParam = url.searchParams.get("rankBy");
    const rankBy: LegacyRankBy = rankByParam === "netWorth" ? "netWorth" : "legacy";

    const db = await getDb();
    const authUser = await getAuthUser();
    const data = await getLegacyLeaderboardData(db, authUser ? { userId: authUser.userId } : null, {
      scope,
      rankBy,
    });

    // `self` is per-caller. The CDN in front of this app ignores the session
    // cookie as a cache key, so a shared-cache header here would let a signed-in
    // caller's rank/lives get served to the next anonymous (or different) caller
    // within the cache window. Only anonymous responses (self === null) are safe
    // to cache publicly.
    const cacheControl = authUser
      ? "private, no-store"
      : "public, s-maxage=60, stale-while-revalidate=120, no-transform";

    return NextResponse.json(
      { entries: data.entries.slice(0, limit), total: data.total, self: data.self },
      { headers: { "Cache-Control": cacheControl } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
