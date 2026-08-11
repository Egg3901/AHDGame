/**
 * GET /api/country/[code]/approval — lightweight national government approval rating + history.
 * Population-weighted average of all state approvals vs national metric averages.
 * History is read from the governmentApprovals collection (snapshotted each turn).
 *
 * The computation lives in @/lib/country/nationalApproval so server components can
 * call it directly (no self-fetch); this route is a thin HTTP wrapper.
 */
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { loadNationalApproval } from "@/lib/country/nationalApproval";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const data = await loadNationalApproval(countryId);
    // cache policy: game-state — approval reflects the latest turn snapshot; no shared cache
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store, no-transform" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
