import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import type { MetricCategoryId } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { loadNationalMetrics } from "@/lib/country/nationalMetrics";

// GET - Get aggregated national metrics
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const categoryFilter = searchParams.get("category") as MetricCategoryId | null;
    const response = await loadNationalMetrics(countryId, categoryFilter);
    if (!response) {
      return NextResponse.json({ error: "No metrics data available" }, { status: 404 });
    }
    // Game-state sensitive (live approval + per-turn metrics): serve fresh, and
    // make that explicit so no CDN rule can cache a stale masthead. Matches the
    // sibling approval route (Kimi review).
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store, no-transform" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
