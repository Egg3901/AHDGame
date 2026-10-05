// POST /api/country/[code]/executive/cabinet/[positionId]/military/assign-branch
// Assign every unit of a branch to a general (or to General Staff when null).
// Same write as the per-unit assign route, batched. Auth: defense holder or
// admin. Free (no action cost). Gated by conflictsEnabled + defense seat.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
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
import { theaterOfUnit } from "@/lib/military/assignments";
import { assignmentSet } from "@/lib/military/assignmentSet";
import {
  DEFENSE_POSITION_BY_COUNTRY,
  MILITARY_BRANCHES_BY_COUNTRY,
} from "@/lib/constants/military";

const assignBranchSchema = z.object({
  branchId: z.string().min(1),
  assignedGeneralId: z.string().nullable(),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return errorResponse(404, "Not a defense cabinet position");
    }

    const parsed = await parseJsonBody(request, assignBranchSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    const { branchId, assignedGeneralId } = parsed.data;

    const catalog = MILITARY_BRANCHES_BY_COUNTRY[countryId] ?? [];
    if (!catalog.some((b) => b.id === branchId)) {
      return errorResponse(400, "Unknown branch");
    }

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

    const { conflictAssignments } = await getMilitaryFormations(db, countryId);
    const col = getMilitaryUnitsCollection(db);
    const units = await col
      .find({ countryId, branchId }, { projection: { _id: 1, posture: 1 } })
      .toArray();

    if (units.length === 0) {
      return NextResponse.json({
        ok: true,
        assigned: 0,
        assignedGeneralId,
        theaterId: theaterOfUnit(assignedGeneralId, conflictAssignments),
      });
    }

    await col.bulkWrite(
      units.map((u) => ({
        updateOne: {
          filter: { _id: u._id, countryId },
          update: { $set: assignmentSet(assignedGeneralId, conflictAssignments, u.posture) },
        },
      }))
    );

    return NextResponse.json({
      ok: true,
      assigned: units.length,
      assignedGeneralId,
      theaterId: theaterOfUnit(assignedGeneralId, conflictAssignments),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
