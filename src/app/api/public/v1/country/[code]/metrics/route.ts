import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { publicError } from "@/lib/publicApi/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import {
  isPublicMetricCategory,
  queryCountryMetrics,
} from "@/lib/publicApi/metrics";

// GET /api/public/v1/country/[code]/metrics?category=CATEGORY
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const guard = await publicApiGuard(request, "country-metrics");
    if (!guard.ok) return guard.response;
    const categoryParam = new URL(request.url).searchParams.get("category");
    if (categoryParam && !isPublicMetricCategory(categoryParam)) {
      return publicError("BAD_REQUEST", "Invalid metric category", 400);
    }
    const category = categoryParam && isPublicMetricCategory(categoryParam) ? categoryParam : null;
    const { code } = await params;
    const result = await queryCountryMetrics(code, category);
    if (!result) return publicError("INVALID_COUNTRY", "Invalid country code", 400);
    if (!result.found) return publicError("NOT_FOUND", "Country metrics not found", 404);
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
