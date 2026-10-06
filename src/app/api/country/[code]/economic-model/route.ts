import { NextResponse } from "next/server";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { StateMetrics } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { presentEconomicModel } from "@/lib/economicModels/present";

/**
 * GET /api/country/[code]/economic-model
 * Returns the presented economic-model identity (P7) for the country. The economic
 * model is NATIONAL ONLY — every region inherits its nation's model — so any legacy
 * `?regionId=` is ignored and the national doc is always returned. Read-only public
 * country data (same access posture as the metrics route). 404 until the
 * classification phase has run.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const docId = getNationalDocId(countryId);
    if (!docId) {
      return errorResponse(404, "No national document for country");
    }

    const db = await getDb();
    const doc = await db
      .collection<StateMetrics>("macroMetrics")
      .findOne({ _id: docId }, { projection: { economicModel: 1 } });

    if (!doc?.economicModel) {
      return errorResponse(404, "No economic model classified yet");
    }

    return NextResponse.json(presentEconomicModel(doc.economicModel));
  } catch (error) {
    return handleRouteError(error);
  }
}
