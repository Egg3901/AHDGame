// POST /api/country/[code]/executive/cabinet/[positionId]/estates/[estateId]/expand
// Raise tier by 1 (cap 3). Auth: seat holder or admin. Costs 1 ministerial action.
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
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import { resolveEstatePortfolio } from "@/lib/constants/cabinetEstates";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; estateId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
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
    const membersCol = getCabinetMembersCollection(db);
    const estatesCol = getCabinetEstatesCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the seat holder or admin can expand estates");
    }

    // Expanding an estate raises the standing cost the successor inherits.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const estate = await estatesCol.findOne({ _id: new ObjectId(estateId), countryId, positionId });
    if (!estate) {
      return errorResponse(404, "Estate not found");
    }
    if (estate.tier >= 3) {
      return errorResponse(400, "Estate is already at the highest tier");
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
      await estatesCol.updateOne(
        { _id: estate._id },
        { $set: { tier: (estate.tier + 1) as 0 | 1 | 2 | 3 } }
      );
    } catch (error) {
      await refundMinisterialAction(db, countryId, member!);
      throw error;
    }

    return NextResponse.json({
      success: true,
      tier: estate.tier + 1,
      actionsRemaining: spend.remaining,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
