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
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, assignBranchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { branchId, assignedGeneralId } = parsed.data;

    const catalog = MILITARY_BRANCHES_BY_COUNTRY[countryId] ?? [];
    if (!catalog.some((b) => b.id === branchId)) {
      return NextResponse.json({ error: "Unknown branch" }, { status: 400 });
    }

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the defence minister may assign units." },
        { status: 403 }
      );
    }

    if (assignedGeneralId) {
      const commission = await getCharacterCommission(db, assignedGeneralId);
      if (!commission.commissioned) {
        return NextResponse.json({ error: "Not a commissioned general" }, { status: 400 });
      }
      const generals = await listCountryGenerals(db, countryId);
      if (!generals.some((g) => g.id === assignedGeneralId)) {
        return NextResponse.json({ error: "General not in this country" }, { status: 400 });
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
