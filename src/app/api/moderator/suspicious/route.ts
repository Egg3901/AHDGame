// Paginated list of suspicious characters for moderator review.
// Auth: requireModerator
// Errors: 400, 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isCountryEnabledForPlayers } from "@/lib/countryAccess";
import type { SuspiciousCharacter } from "@/lib/db/types/activityLog";
import { fetchSuspiciousList } from "@/lib/admin/suspiciousList";

const ALLOWED_SEVERITIES = ["low", "medium", "high"] as const;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);

    const severityParam = searchParams.get("severity");
    const countryParam = searchParams.get("country");
    const dismissedParam = searchParams.get("dismissed");
    const deletedParam = searchParams.get("deleted");
    const showResolvedParam = searchParams.get("showResolved");
    const flagTypeParam = searchParams.get("flagType");
    const cursorParam = searchParams.get("cursor");
    const limitParam = searchParams.get("limit");

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    );

    if (
      severityParam &&
      !ALLOWED_SEVERITIES.includes(severityParam as (typeof ALLOWED_SEVERITIES)[number])
    ) {
      return NextResponse.json({ error: "Invalid severity" }, { status: 400 });
    }

    if (cursorParam && !/^[0-9a-f]{24}$/i.test(cursorParam)) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const db = await getDb();

    let countryId: SuspiciousCharacter["countryId"] | undefined;
    if (countryParam) {
      const upper = countryParam.toUpperCase() as CountryId;
      if (!COUNTRY_CONFIGS[upper]) {
        return NextResponse.json({ error: "Invalid country" }, { status: 400 });
      }
      if (!(await isCountryEnabledForPlayers(db, upper))) {
        return NextResponse.json({ error: "Country not enabled for players" }, { status: 400 });
      }
      countryId = upper as SuspiciousCharacter["countryId"];
    }

    const page = await fetchSuspiciousList(db, {
      severity: severityParam
        ? (severityParam as SuspiciousCharacter["highestSeverity"])
        : undefined,
      countryId,
      showDismissed: dismissedParam === "true",
      deleted: deletedParam === "true",
      showResolved: showResolvedParam === "true",
      flagType: flagTypeParam ?? undefined,
      cursor: cursorParam ?? null,
      limit,
    });

    return NextResponse.json(page);
  } catch (error) {
    return handleRouteError(error);
  }
}
