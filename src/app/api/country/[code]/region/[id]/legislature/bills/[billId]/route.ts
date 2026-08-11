/**
 * GET /api/country/[code]/region/[id]/legislature/bills/[billId] — Single state bill detail
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    if (!ObjectId.isValid(billId)) {
      return NextResponse.json({ error: "Invalid bill ID" }, { status: 400 });
    }
    const stateId = id;

    const [db, authUser] = await Promise.all([getDb(), getAuthUser().catch(() => null)]);
    const bill = await getStateLegislatureBillDetail(db, {
      countryId,
      stateId,
      billId,
      authUser,
    });
    if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

    return NextResponse.json(bill);
  } catch (error) {
    return handleRouteError(error);
  }
}
