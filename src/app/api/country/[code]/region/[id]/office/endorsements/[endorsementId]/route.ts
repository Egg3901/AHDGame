import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!ObjectId.isValid(endorsementId)) {
      return NextResponse.json({ error: "Invalid endorsementId" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const holder = await getOfficeHolderRow(db, countryId, stateId, auth.user.character._id);
    if (!holder) return NextResponse.json({ error: "Not the office-holder" }, { status: 403 });

    const oid = new ObjectId(endorsementId);
    const endorsement = await db
      .collection<GovernorEndorsement>("governorEndorsements")
      .findOne({ _id: oid });
    if (!endorsement) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (endorsement.endorsedByCharacterId.toString() !== auth.user.character._id.toString()) {
      return NextResponse.json({ error: "Not your endorsement" }, { status: 403 });
    }

    const result = await withdrawEndorsement(db, oid, "manual");
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
