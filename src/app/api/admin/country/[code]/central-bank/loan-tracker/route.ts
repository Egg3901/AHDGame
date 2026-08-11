// GET /api/admin/country/[code]/central-bank/loan-tracker - Admin LOC borrower rows for one central bank currency.
// Auth: requireAdmin
// Errors: 403, 404
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import { loadAdminLoanTracker } from "@/lib/monetaryPolicy/queries/adminLoanTracker";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Country not found" }, { status: 404 });
    }

    const db = await getDb();
    const detail = await loadAdminLoanTracker({ db, countryId });
    if (!detail.ok) {
      return NextResponse.json({ error: detail.error }, { status: detail.status });
    }

    return NextResponse.json(detail.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
