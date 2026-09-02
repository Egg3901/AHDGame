import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { canonicalRegionId } from "@/lib/constants/countries";
import { loadRegionPoliticalMetrics } from "@/lib/politicalMetrics/queries/regionPoliticalMetrics";
import {
  POLITICAL_METRIC_COUNTRY_IDS,
  type PoliticalMetricsCountryId,
} from "@/lib/politicalMetrics/types";

// GET /api/country/[code]/region/[id]/political-metrics — one region's registry:
// its own values, the national comparison, per-metric modifiers, relevant
// legislation, underlying statistics and trend series.
// Auth: public (the same standing as the national registry).
// Errors: 404 (country has no board, or region has no board doc).
//
// No Zod schema: there is no request body and no query parameter. The two path
// params are validated below.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as PoliticalMetricsCountryId;
    if (!POLITICAL_METRIC_COUNTRY_IDS.includes(countryId)) {
      return NextResponse.json(
        { error: "Political metrics not available for this country" },
        { status: 404 }
      );
    }
    const regionId = canonicalRegionId(countryId, id).toUpperCase();
    const response = await loadRegionPoliticalMetrics(countryId, regionId);
    if (!response) {
      return NextResponse.json({ error: "No political metrics for this region" }, { status: 404 });
    }
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store, no-transform" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
