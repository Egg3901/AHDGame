// Paginated, filterable activity log for admin review.
// Auth: requireAdmin
// Errors: 400, 403

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import { fetchActivityLog } from "@/lib/admin/activityLog";

const ALLOWED_TYPES = [
  "turn_summary",
  "fund_event",
  "login",
  "logout",
  "party_change",
  "character_deleted",
  "character_recreated",
  "profile_update",
  "discord_profile_update",
  "game_action",
] as const;
const ALLOWED_FLAG_SEVERITIES = ["low", "medium", "high"];
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);

    const typeParam = searchParams.get("type");
    const userIdParam = searchParams.get("userId");
    const characterIdParam = searchParams.get("characterId");
    const countryParam = searchParams.get("country");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const searchParam = searchParams.get("search");
    const cursorParam = searchParams.get("cursor");
    const limitParam = searchParams.get("limit");
    const flagSeverityParam = searchParams.get("flagSeverity");

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    );

    if (typeParam && !ALLOWED_TYPES.includes(typeParam as (typeof ALLOWED_TYPES)[number])) {
      return errorResponse(400, "Invalid type filter");
    }
    if (userIdParam && !/^[0-9a-f]{24}$/i.test(userIdParam)) {
      return errorResponse(400, "Invalid userId");
    }
    if (characterIdParam && !/^[0-9a-f]{24}$/i.test(characterIdParam)) {
      return errorResponse(400, "Invalid characterId");
    }
    if (cursorParam && !/^[0-9a-f]{24}$/i.test(cursorParam)) {
      return errorResponse(400, "Invalid cursor");
    }

    let from: Date | undefined;
    if (fromParam) {
      from = new Date(fromParam);
      if (isNaN(from.getTime())) {
        return errorResponse(400, "Invalid from date");
      }
    }
    let to: Date | undefined;
    if (toParam) {
      to = new Date(toParam);
      if (isNaN(to.getTime())) {
        return errorResponse(400, "Invalid to date");
      }
    }

    const flagSeverities = flagSeverityParam
      ? flagSeverityParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (flagSeverities.some((s) => !ALLOWED_FLAG_SEVERITIES.includes(s))) {
      return errorResponse(400, "Invalid flagSeverity");
    }

    const db = await getDb();

    let countryId: string | undefined;
    if (countryParam) {
      const upper = countryParam.toUpperCase() as CountryId;
      if (!COUNTRY_CONFIGS[upper]) {
        return errorResponse(400, "Invalid country");
      }
      if (!(await isCountryEnabledForPlayers(db, upper))) {
        return errorResponse(400, "Country not enabled for players");
      }
      countryId = upper;
    }

    const page = await fetchActivityLog(db, {
      type: typeParam ?? undefined,
      userId: userIdParam ? new ObjectId(userIdParam) : undefined,
      characterId: characterIdParam ? new ObjectId(characterIdParam) : undefined,
      countryId,
      from,
      to,
      search: searchParam?.trim() || undefined,
      flagSeverities,
      cursor: cursorParam ?? null,
      limit,
    });

    return NextResponse.json({
      events: page.events,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
