// GET /api/country/[code]/nationalization-target-detail?corporationId=<id>
// Nationalization-relevant detail for ONE corporation, for the bill provision
// editor (and any "review the target" surface): owner kind, eligibility triggers,
// sectors by region, value. Unlike /nationalization-targets (executive-only,
// HoG-gated), this works for any selected corp — the legislative path can take
// solvent player corps that the executive cannot.
// Thin wrapper over the shared computeNationalizationTargetDetail helper (also
// used by the enacted-bill detail view) so the detail never drifts.
// Auth: requireAuthWithCharacter. Errors: 400, 401, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { computeNationalizationTargetDetail } from "@/lib/nationalization/billTargetPreview";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }
    const corporationId = new URL(request.url).searchParams.get("corporationId");
    if (!corporationId || !ObjectId.isValid(corporationId)) {
      return errorResponse(400, "Invalid corporation ID");
    }

    const db = await getDb();
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(corporationId) });
    if (!corp || corp.countryId !== countryId) {
      return errorResponse(404, "Corporation not found in this country.");
    }
    if (isStateOwned(corp)) {
      return errorResponse(400, "That corporation is already state-owned.");
    }

    const currentTurn = await getCurrentTurn(db);
    const detail = await computeNationalizationTargetDetail(db, countryId, corp, currentTurn);
    return NextResponse.json(detail);
  } catch (error) {
    return handleRouteError(error);
  }
}
