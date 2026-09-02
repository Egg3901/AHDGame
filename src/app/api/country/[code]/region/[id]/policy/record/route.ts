import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, canonicalRegionId, type CountryId } from "@/lib/constants/countries";
import { loadRegionPolicyRecordPayload } from "@/lib/policy/regionPolicyRecordPayload";

// GET /api/country/[code]/region/[id]/policy/record — the region's own Living
// Code: its replayed axes timeline, the current regional administration, and
// per-law provenance (enactment stamp + annual cost) for its statute book.
// Read-side only.
// Auth: public (the same standing as the national record).
// Errors: 400.
//
// No Zod schema: no request body, no query parameter. Both path params are
// validated below.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const regionId = canonicalRegionId(countryId, id).toUpperCase();
    const payload = await loadRegionPolicyRecordPayload(countryId, regionId);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0, no-transform" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
