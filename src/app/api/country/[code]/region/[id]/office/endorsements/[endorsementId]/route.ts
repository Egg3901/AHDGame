import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getOfficeHolderRow } from "@/lib/governorOffice/queries";
import { withdrawEndorsement } from "@/lib/governorOffice/endorsements/withdrawEndorsement";
import type { GovernorEndorsement } from "@/lib/db/types";

// DELETE /api/country/[code]/region/[id]/office/endorsements/[endorsementId] — Withdraw.
// Auth: requireHumanSessionWithCharacter; must be the original endorser.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; endorsementId: string }> }
) {
  try {
    const { code, id, endorsementId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (!ObjectId.isValid(endorsementId)) {
      return errorResponse(400, "Invalid endorsementId");
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const holder = await getOfficeHolderRow(db, countryId, stateId, auth.user.character._id);
    if (!holder) return errorResponse(403, "Not the office-holder");

    const oid = new ObjectId(endorsementId);
    const endorsement = await db
      .collection<GovernorEndorsement>("governorEndorsements")
      .findOne({ _id: oid });
    if (!endorsement) return errorResponse(404, "Not found");
    if (endorsement.endorsedByCharacterId.toString() !== auth.user.character._id.toString()) {
      return errorResponse(403, "Not your endorsement");
    }

    const result = await withdrawEndorsement(db, oid, "manual");
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
