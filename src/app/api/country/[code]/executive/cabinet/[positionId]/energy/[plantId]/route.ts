// DELETE /api/country/[code]/executive/cabinet/[positionId]/energy/[plantId]
// Retire a plant. Auth: energy holder or admin. Free. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getEnergyPlantsCollection } from "@/lib/db/collections/energyPlants";
import { resolveEnergyPosition } from "@/lib/constants/cabinetEnergy";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; plantId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId, plantId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (!resolveEnergyPosition(countryId, positionId)) {
      return errorResponse(404, "Not an energy cabinet position");
    }
    if (!ObjectId.isValid(plantId)) {
      return errorResponse(400, "Invalid plant id");
    }

    const db = await getDb();
    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the energy holder or admin can retire plants");
    }

    // Retiring a plant is not something the successor can undo.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const result = await getEnergyPlantsCollection(db).deleteOne({
      _id: new ObjectId(plantId),
      countryId,
      positionId,
    });
    if (result.deletedCount === 0) {
      return errorResponse(404, "Plant not found");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
