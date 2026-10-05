/**
 * GET /api/country/[code]/region/[id]/legislature/bills/[billId] — Single state bill detail
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getStateLegislatureBillDetail } from "@/lib/legislature/queries/stateBillQueries";

// GET /api/country/[code]/region/[id]/legislature/bills/[billId]
// Auth: public
// Errors: 400, 404
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string; billId: string }> }
) {
  try {
    const { code, id, billId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }
    if (!ObjectId.isValid(billId)) {
      return errorResponse(400, "Invalid bill ID");
    }
    const stateId = id;

    const [db, authUser] = await Promise.all([getDb(), getAuthUser().catch(() => null)]);
    const bill = await getStateLegislatureBillDetail(db, {
      countryId,
      stateId,
      billId,
      authUser,
    });
    if (!bill) return errorResponse(404, "Bill not found");

    return NextResponse.json(bill);
  } catch (error) {
    return handleRouteError(error);
  }
}
