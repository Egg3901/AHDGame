// POST /api/country/[code]/executive/cabinet/[positionId]/energy/[plantId]/upgrade
// Raise tier by 1 (cap 3). Auth: energy holder or admin. Costs 1 ministerial action.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  refundMinisterialAction,
  resolveMinisterialRemaining,
  spendMinisterialAction,
} from "@/lib/cabinet/ministerialActionPool";
import { getEnergyPlantsCollection } from "@/lib/db/collections/energyPlants";
import { resolveEnergyPosition } from "@/lib/constants/cabinetEnergy";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; plantId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
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
    const membersCol = getCabinetMembersCollection(db);
    const plantsCol = getEnergyPlantsCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the energy holder or admin can upgrade plants");
    }

    // An upgrade raises the standing cost the successor inherits.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const plant = await plantsCol.findOne({ _id: new ObjectId(plantId), countryId, positionId });
    if (!plant) {
      return errorResponse(404, "Plant not found");
    }
    if (plant.tier >= 3) {
      return errorResponse(400, "Plant is already at the highest tier");
    }

    // Shared UK pool: both offices of a dual holder spend one balance (issue #2049).
    const actions = await resolveMinisterialRemaining(db, countryId, member!);
    if (actions < 1) {
      return errorResponse(400, "No ministerial actions remaining");
    }

    const spend = await spendMinisterialAction(db, countryId, member!);
    if (!spend.ok) {
      return errorResponse(409, "No ministerial actions remaining");
    }

    try {
      await plantsCol.updateOne(
        { _id: plant._id },
        { $set: { tier: (plant.tier + 1) as 0 | 1 | 2 | 3 } }
      );
    } catch (error) {
      await refundMinisterialAction(db, countryId, member!);
      throw error;
    }

    return NextResponse.json({
      success: true,
      tier: plant.tier + 1,
      actionsRemaining: spend.remaining,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
