import { NextResponse } from "next/server";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { loadCountryPoliticalMetrics } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import {
  POLITICAL_METRIC_COUNTRY_IDS,
  type PoliticalMetricsCountryId,
} from "@/lib/politicalMetrics/types";

// GET — national + per-region political metrics for a playable country
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as PoliticalMetricsCountryId;
    if (!POLITICAL_METRIC_COUNTRY_IDS.includes(countryId)) {
      return errorResponse(404, "Political metrics not available for this country");
    }
    const response = await loadCountryPoliticalMetrics(countryId);
    if (!response) {
      return errorResponse(404, "No political metrics data available");
    }
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store, no-transform" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
