import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { loadPolicyRecordPayload } from "@/lib/policy/policyRecordPayload";

// GET /api/country/[code]/policy/record - The Living Code (Record view):
// replayed national-axes timeline with per-enactment nodes, the current
// administration era, and per-type provenance (enactment stamp + annual
// cost) for the statute book. Read-side only.
// Auth: public
// Errors: 400
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const payload = await loadPolicyRecordPayload(countryId);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0, no-transform" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
