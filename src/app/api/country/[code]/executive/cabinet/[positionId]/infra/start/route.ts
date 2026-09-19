// POST /api/country/[code]/executive/cabinet/[positionId]/infra/start
// Auth: requireAuth — transportation seat holder or admin. Costs 1 ministerial action.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
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
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!resolveInfraPosition(countryId, positionId)) {
      return NextResponse.json({ error: "Not a transportation cabinet position" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, startSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const arch = getInfraArchetype(parsed.data.archetypeId);
    if (!arch) {
      return NextResponse.json({ error: "Invalid project type" }, { status: 400 });
    }

    const db = await getDb();
    const region = await db
      .collection<{ _id: string; countryId: string }>("states")
      .findOne({ _id: parsed.data.regionId, countryId }, { projection: { _id: 1 } });
    if (!region) {
      return NextResponse.json({ error: "Invalid region for this country" }, { status: 400 });
    }

    const membersCol = getCabinetMembersCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the transportation holder or admin can start projects" },
        { status: 403 }
      );
    }

    // Breaking ground commits the department's budget for the build's duration.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    if (member && member.ministerialActions == null) {
      await membersCol.updateOne({ _id: member._id }, { $set: { ministerialActions: 2 } });
      member.ministerialActions = 2;
    }
    const actions = member?.ministerialActions ?? 2;
    if (actions < 1) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 400 });
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    const spend = await membersCol.updateOne(
      { _id: member!._id, ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
    if (spend.modifiedCount === 0) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 409 });
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
      await membersCol.updateOne({ _id: member!._id }, { $inc: { ministerialActions: 1 } });
      throw error;
    }

    return NextResponse.json({ success: true, actionsRemaining: actions - 1 });
  } catch (error) {
    return handleRouteError(error);
  }
}
