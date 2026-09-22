import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { loadUsPoliticalStateIds } from "@/lib/elections/usPoliticalHome";
import { loadMapMetrics } from "@/lib/map/metricsService";

// GET /api/map/metrics: public current US state indicators; no player-specific fields.
export async function GET(request: Request) {
  if ((new URL(request.url).searchParams.get("countryId") ?? "US").toUpperCase() !== "US") {
    return NextResponse.json(
      { error: "Metrics map is only available for the US" },
      { status: 400 }
    );
  }
  try {
    const db = await getDb();
    const { politicalIds } = await loadUsPoliticalStateIds(db);
    return NextResponse.json(await loadMapMetrics(db, [...politicalIds]), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/map/metrics" });
  }
}
