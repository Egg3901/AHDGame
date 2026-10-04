// POST /api/country/[code]/executive/cabinet/[positionId]/estates/[estateId]/fund
// Set funding level. Auth: seat holder or admin. Free. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import { resolveEstatePortfolio } from "@/lib/constants/cabinetEstates";

const fundSchema = z.object({
  fundingLevel: z.enum(["reduced", "standard", "enhanced"]),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string; estateId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId, estateId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (!resolveEstatePortfolio(countryId, positionId)) {
      return errorResponse(404, "Not an estates cabinet position");
    }
    if (!ObjectId.isValid(estateId)) {
      return errorResponse(400, "Invalid estate id");
    }

    const parsed = await parseJsonBody(request, fundSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the seat holder or admin can set funding");
    }

    const result = await getCabinetEstatesCollection(db).updateOne(
      { _id: new ObjectId(estateId), countryId, positionId },
      { $set: { fundingLevel: parsed.data.fundingLevel } }
    );
    if (result.matchedCount === 0) {
      return errorResponse(404, "Estate not found");
    }
    return NextResponse.json({ success: true, fundingLevel: parsed.data.fundingLevel });
  } catch (error) {
    return handleRouteError(error);
  }
}
