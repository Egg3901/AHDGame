// DELETE /api/country/[code]/executive/cabinet/[positionId]/infra/[projectId]
// Cancel an in-progress project or retire an operational one. Auth: holder/admin. Free.
// Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getInfraProjectsCollection } from "@/lib/db/collections/infraProjects";
import { resolveInfraPosition } from "@/lib/constants/cabinetInfra";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; projectId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
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

    const db = await getDb();
    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the transportation holder or admin can cancel projects");
    }

    // Cancelling a project writes off work the successor may have wanted.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const result = await getInfraProjectsCollection(db).deleteOne({
      _id: new ObjectId(projectId),
      countryId,
      positionId,
    });
    if (result.deletedCount === 0) {
      return errorResponse(404, "Project not found");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
