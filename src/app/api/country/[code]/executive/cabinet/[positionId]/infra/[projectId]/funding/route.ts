// POST /api/country/[code]/executive/cabinet/[positionId]/infra/[projectId]/funding
// Set build funding (construction only). Auth: holder/admin. Free. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
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
      return errorResponse(400, "Invalid country");
    }
    if (!resolveInfraPosition(countryId, positionId)) {
      return errorResponse(404, "Not a transportation cabinet position");
    }
    if (!ObjectId.isValid(projectId)) {
      return errorResponse(400, "Invalid project id");
    }

    const parsed = await parseJsonBody(request, fundingSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
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
      return errorResponse(403, "Only the transportation holder or admin can set build funding");
    }

    const project = await projectsCol.findOne({
      _id: new ObjectId(projectId),
      countryId,
      positionId,
    });
    if (!project) {
      return errorResponse(404, "Project not found");
    }
    if (project.status === "operational") {
      return errorResponse(400, "Cannot change build funding on a completed project");
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
