// DELETE /api/country/[code]/executive/cabinet/[positionId]/estates/[estateId]
// Close an estate. Auth: seat holder or admin. Free. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import { resolveEstatePortfolio } from "@/lib/constants/cabinetEstates";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; estateId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
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

    const db = await getDb();
    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the seat holder or admin can close estates");
    }

    // Closing an estate is not reversible by the confirmed successor.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const result = await getCabinetEstatesCollection(db).deleteOne({
      _id: new ObjectId(estateId),
      countryId,
      positionId,
    });
    if (result.deletedCount === 0) {
      return errorResponse(404, "Estate not found");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
