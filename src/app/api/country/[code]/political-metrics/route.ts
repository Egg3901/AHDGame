import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json(
        { error: "Political metrics not available for this country" },
        { status: 404 }
      );
    }
    const response = await loadCountryPoliticalMetrics(countryId);
    if (!response) {
      return NextResponse.json({ error: "No political metrics data available" }, { status: 404 });
    }
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store, no-transform" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
