// DELETE /api/country/[code]/executive/cabinet/[positionId]/military/[unitId]
// Disband a unit. Auth: defense holder or admin. Free. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { returnManpower } from "@/lib/military/manpowerPool";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; unitId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId, unitId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return errorResponse(404, "Not a defense cabinet position");
    }
    if (!ObjectId.isValid(unitId)) {
      return errorResponse(400, "Invalid unit id");
    }

    const db = await getDb();
    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the defence minister may disband units.");
    }

    const unitsCol = getMilitaryUnitsCollection(db);
    const unit = await unitsCol.findOne({ _id: new ObjectId(unitId), countryId });
    if (!unit) {
      return errorResponse(404, "Unit not found");
    }

    const result = await unitsCol.deleteOne({ _id: new ObjectId(unitId), countryId });
    if (result.deletedCount === 0) {
      return errorResponse(404, "Unit not found");
    }

    // Demobilised men go home. No cash refund — the unrefunded purchase price is
    // what keeps unit churn expensive.
    //
    // The unit is already deleted and cannot be restored, so a manpower failure
    // must not turn a successful disband into a 500 the client retries: log and
    // return success. The men are lost, which is strictly better than the caller
    // believing the unit still exists.
    if (unit.personnel > 0) {
      try {
        await returnManpower(db, countryId, unit.personnel);
      } catch (error) {
        console.error(
          `[disband] ${countryId}: unit ${unitId} deleted but ${unit.personnel} manpower not returned`,
          error
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
