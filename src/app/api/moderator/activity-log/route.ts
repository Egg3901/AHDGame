// Paginated, filterable activity log for moderator review.
// Auth: requireModerator
// Errors: 400, 403

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
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

export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

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
      return NextResponse.json({ error: "Invalid type filter" }, { status: 400 });
    }
    if (userIdParam && !/^[0-9a-f]{24}$/i.test(userIdParam)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    if (characterIdParam && !/^[0-9a-f]{24}$/i.test(characterIdParam)) {
      return NextResponse.json({ error: "Invalid characterId" }, { status: 400 });
    }
    if (cursorParam && !/^[0-9a-f]{24}$/i.test(cursorParam)) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    let from: Date | undefined;
    if (fromParam) {
      from = new Date(fromParam);
      if (isNaN(from.getTime())) {
        return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
      }
    }
    let to: Date | undefined;
    if (toParam) {
      to = new Date(toParam);
      if (isNaN(to.getTime())) {
        return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
      }
    }

    const flagSeverities = flagSeverityParam
      ? flagSeverityParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    if (flagSeverities.some((s) => !ALLOWED_FLAG_SEVERITIES.includes(s))) {
      return NextResponse.json({ error: "Invalid flagSeverity" }, { status: 400 });
    }

    const db = await getDb();

    let countryId: string | undefined;
    if (countryParam) {
      const upper = countryParam.toUpperCase() as CountryId;
      if (!COUNTRY_CONFIGS[upper]) {
        return NextResponse.json({ error: "Invalid country" }, { status: 400 });
      }
      if (!(await isCountryEnabledForPlayers(db, upper))) {
        return NextResponse.json({ error: "Country not enabled for players" }, { status: 400 });
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
}
