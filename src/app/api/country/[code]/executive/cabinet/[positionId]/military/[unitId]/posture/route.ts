// POST /api/country/[code]/executive/cabinet/[positionId]/military/[unitId]/posture
// Auth: defense holder or admin. Free (no action cost). Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { isAtConflict } from "@/lib/military/theaters";

const postureSchema = z.object({
  posture: z.enum(["garrison", "standard", "forward", "alert"]),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string; unitId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
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

    const parsed = await parseJsonBody(request, postureSchema);
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
      return errorResponse(403, "Only the defence minister may set a unit’s posture.");
    }

    const col = getMilitaryUnitsCollection(db);
    const unit = await col.findOne(
      { _id: new ObjectId(unitId), countryId },
      { projection: { theaterId: 1 } }
    );
    if (!unit) {
      return errorResponse(404, "Unit not found");
    }
    // A unit deployed to a Conflict must hold at least Standard posture.
    if (parsed.data.posture === "garrison" && isAtConflict(unit.theaterId)) {
      return errorResponse(400, "Units deployed to a conflict must hold at least Standard posture");
    }

    await col.updateOne(
      { _id: new ObjectId(unitId), countryId },
      { $set: { posture: parsed.data.posture } }
    );

    return NextResponse.json({ success: true, posture: parsed.data.posture });
  } catch (error) {
    return handleRouteError(error);
  }
}
