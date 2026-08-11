// POST /api/country/[code]/executive/cabinet/[positionId]/infra/[projectId]/funding
// Set build funding (construction only). Auth: holder/admin. Free. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getInfraProjectsCollection } from "@/lib/db/collections/infraProjects";
import { resolveInfraPosition } from "@/lib/constants/cabinetInfra";

const fundingSchema = z.object({ fundingLevel: z.enum(["slowed", "standard", "crashed"]) });

interface RouteParams {
  params: Promise<{ code: string; positionId: string; projectId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId, projectId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!resolveInfraPosition(countryId, positionId)) {
      return NextResponse.json({ error: "Not a transportation cabinet position" }, { status: 404 });
    }
    if (!ObjectId.isValid(projectId)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, fundingSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const membersCol = getCabinetMembersCollection(db);
    const projectsCol = getInfraProjectsCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the transportation holder or admin can set build funding" },
        { status: 403 }
      );
    }

    const project = await projectsCol.findOne({
      _id: new ObjectId(projectId),
      countryId,
      positionId,
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (project.status === "operational") {
      return NextResponse.json(
        { error: "Cannot change build funding on a completed project" },
        { status: 400 }
      );
    }

    await projectsCol.updateOne(
      { _id: project._id },
      { $set: { fundingLevel: parsed.data.fundingLevel } }
    );
    return NextResponse.json({ success: true, fundingLevel: parsed.data.fundingLevel });
  } catch (error) {
    return handleRouteError(error);
  }
}
