import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { withdrawExecutiveEndorsement } from "@/lib/governorOffice/endorsements/withdrawExecutiveEndorsement";

// DELETE /api/country/[code]/executive/endorsements/[id] — sitting leader
// withdraws an active executive endorsement they previously issued.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (!ObjectId.isValid(id)) {
      return errorResponse(400, "Invalid id");
    }
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader) {
      return errorResponse(403, "Only the sitting leader can withdraw this endorsement");
    }

    const result = await withdrawExecutiveEndorsement(db, new ObjectId(id), "manual");
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
