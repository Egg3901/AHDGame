import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { publicError } from "@/lib/publicApi/errors";
import { queryLeaderboard } from "@/lib/publicApi/market";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getEnabledCountryIdsFromDb } from "@/lib/countryAccess";

const VALID_METRICS = ["npi", "pi", "favorability", "actions", "funds"] as const;

// GET /api/public/v1/leaderboard?country=CODE&metric=METRIC&limit=N
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "leaderboard");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);

    const rawCountry = url.searchParams.get("country")?.toUpperCase();
    const country =
      rawCountry && rawCountry in COUNTRY_CONFIGS ? (rawCountry as CountryId) : undefined;
    if (rawCountry && !country) {
      return publicError("INVALID_COUNTRY", `Invalid country code: ${rawCountry}`, 400);
    }

    const rawMetric = url.searchParams.get("metric") ?? "npi";
    const metric = (VALID_METRICS as readonly string[]).includes(rawMetric)
      ? rawMetric
      : undefined;
    if (rawMetric && !metric) {
      return publicError(
        "INVALID_METRIC",
        `Invalid metric: ${rawMetric}. Must be one of ${VALID_METRICS.join(", ")}.`,
        400
      );
    }

    let limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
    if (Number.isNaN(limit) || limit < 1) limit = 1;
    if (limit > 50) limit = 50;

    const db = await getDb();

    // Non-admin public consumers can only read enabled countries.
    const enabledCountries = await getEnabledCountryIdsFromDb(db);
    if (country && !enabledCountries.includes(country)) {
      return NextResponse.json(
        { ok: true, found: false, metric, country, characters: [] },
        { headers: guard.headers }
      );
    }

    const result = await queryLeaderboard(db, { country, metric, limit });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
