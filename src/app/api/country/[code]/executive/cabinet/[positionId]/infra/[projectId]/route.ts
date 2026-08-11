// DELETE /api/country/[code]/executive/cabinet/[positionId]/infra/[projectId]
// Cancel an in-progress project or retire an operational one. Auth: holder/admin. Free.
// Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!resolveInfraPosition(countryId, positionId)) {
      return NextResponse.json({ error: "Not a transportation cabinet position" }, { status: 404 });
    }
    if (!ObjectId.isValid(projectId)) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
    }

    const db = await getDb();
    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the transportation holder or admin can cancel projects" },
        { status: 403 }
      );
    }

    const result = await getInfraProjectsCollection(db).deleteOne({
      _id: new ObjectId(projectId),
      countryId,
      positionId,
    });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
