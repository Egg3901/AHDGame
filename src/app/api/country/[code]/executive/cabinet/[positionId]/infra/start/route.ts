// POST /api/country/[code]/executive/cabinet/[positionId]/infra/start
// Auth: requireAuth — transportation seat holder or admin. Costs 1 ministerial action.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  refundMinisterialAction,
  resolveMinisterialRemaining,
  spendMinisterialAction,
} from "@/lib/cabinet/ministerialActionPool";
import { getInfraProjectsCollection } from "@/lib/db/collections/infraProjects";
import { resolveInfraPosition, getInfraArchetype } from "@/lib/constants/cabinetInfra";

const startSchema = z.object({
  archetypeId: z.string(),
  regionId: z.string().min(1),
  name: z.string().min(1).max(80),
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
    if (!resolveInfraPosition(countryId, positionId)) {
      return errorResponse(404, "Not a transportation cabinet position");
    }

    const parsed = await parseJsonBody(request, startSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const arch = getInfraArchetype(parsed.data.archetypeId);
    if (!arch) {
      return errorResponse(400, "Invalid project type");
    }

    const db = await getDb();
    const region = await db
      .collection<{ _id: string; countryId: string }>("states")
      .findOne({ _id: parsed.data.regionId, countryId }, { projection: { _id: 1 } });
    if (!region) {
      return errorResponse(400, "Invalid region for this country");
    }

    const membersCol = getCabinetMembersCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the transportation holder or admin can start projects");
    }

    // Breaking ground commits the department's budget for the build's duration.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    // Shared UK pool: both offices of a dual holder spend one balance (issue #2049).
    const actions = await resolveMinisterialRemaining(db, countryId, member!);
    if (actions < 1) {
      return errorResponse(400, "No ministerial actions remaining");
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const spend = await spendMinisterialAction(db, countryId, member!);
    if (!spend.ok) {
      return errorResponse(409, "No ministerial actions remaining");
    }

    try {
      await getInfraProjectsCollection(db).insertOne({
        _id: new ObjectId(),
        countryId,
        positionId,
        archetypeId: arch.id,
        name: parsed.data.name.trim(),
        icon: arch.icon,
        regionId: parsed.data.regionId,
        status: "construction",
        progress: 0,
        buildDuration: arch.buildDuration,
        fundingLevel: "standard",
        outputBase: arch.outputBase,
        upkeepBase: arch.upkeepBase,
        constructionCostBase: arch.constructionCostBase,
        createdTurn: currentTurn,
      });
    } catch (error) {
      await refundMinisterialAction(db, countryId, member!);
      throw error;
    }

    return NextResponse.json({ success: true, actionsRemaining: spend.remaining });
  } catch (error) {
    return handleRouteError(error);
  }
}
