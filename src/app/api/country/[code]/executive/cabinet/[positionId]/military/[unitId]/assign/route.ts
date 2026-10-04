// POST /api/country/[code]/executive/cabinet/[positionId]/military/[unitId]/assign
// Assign a unit to a general (or to General Staff when null). The unit's theater is
// derived from that general's posting, so it deploys wherever the general is posted.
// Auth: defense holder or admin. Free (no action cost). Gated by conflictsEnabled +
// defense seat. Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import {
  getCharacterCommission,
  listCountryGenerals,
} from "@/lib/db/collections/characterGenerals";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { assignmentSet } from "@/lib/military/assignmentSet";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";

const assignSchema = z.object({ assignedGeneralId: z.string().nullable() });

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

    const parsed = await parseJsonBody(request, assignSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { assignedGeneralId } = parsed.data;

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return errorResponse(404, "Conflicts subsystem disabled");
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the defence minister may assign units.");
    }

    // A unit may only be assigned to a commissioned general of THIS country.
    if (assignedGeneralId) {
      const commission = await getCharacterCommission(db, assignedGeneralId);
      if (!commission.commissioned) {
        return errorResponse(400, "Not a commissioned general");
      }
      const generals = await listCountryGenerals(db, countryId);
      if (!generals.some((g) => g.id === assignedGeneralId)) {
        return errorResponse(400, "General not in this country");
      }
    }

    // The unit's theater follows its general's posting (reserve when unassigned/unposted).
    const { conflictAssignments } = await getMilitaryFormations(db, countryId);

    const col = getMilitaryUnitsCollection(db);
    const existing = await col.findOne(
      { _id: new ObjectId(unitId), countryId },
      { projection: { posture: 1 } }
    );
    if (!existing) {
      return errorResponse(404, "Unit not found");
    }
    const set = assignmentSet(assignedGeneralId, conflictAssignments, existing.posture);
    const theaterId = set.theaterId;
    const posture = set.posture ?? existing.posture;

    await col.updateOne({ _id: new ObjectId(unitId), countryId }, { $set: set });

    return NextResponse.json({ ok: true, assignedGeneralId, theaterId, posture });
  } catch (error) {
    return handleRouteError(error);
  }
}
