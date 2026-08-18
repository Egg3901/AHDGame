/**
 * GET /api/admin/country/[code]/readiness
 *
 * Admin diagnostic — returns a readiness report for the given country
 * without making any writes. Driven by COUNTRY_READINESS_EXPECTATIONS so
 * every supported country gets the same checks.
 *
 * Auth: requireAdmin
 * Errors: 400 (unknown country), 403, 404 (no expectations entry)
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { buildCountryReadinessReport } from "@/lib/admin/countryReadinessReport";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const db = await getDb();
    const report = await buildCountryReadinessReport(db, countryId);
    if (!report) {
      return NextResponse.json(
        { error: `No readiness expectations registered for ${countryId}` },
        { status: 404 }
      );
    }

    return NextResponse.json(report);
  } catch (error) {
    return handleRouteError(error);
  }
}
