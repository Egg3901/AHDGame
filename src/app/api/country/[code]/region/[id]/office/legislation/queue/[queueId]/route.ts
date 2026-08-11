import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canManageOffice } from "@/lib/governorOffice/access";
import { cancelQueue } from "@/lib/governorOffice/legislation/cancelQueue";
import type { GovernorQueuedBill } from "@/lib/db/types";

// DELETE /api/country/[code]/region/[id]/office/legislation/queue/[queueId]
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; queueId: string }> }
) {
  try {
    const { code, id, queueId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!ObjectId.isValid(queueId)) {
      return NextResponse.json({ error: "Invalid queueId" }, { status: 400 });
    }
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const canManage = await canManageOffice(db, countryId, stateId, auth.user.character._id);
    if (!canManage)
      return NextResponse.json({ error: "Not authorized for this office" }, { status: 403 });

    const oid = new ObjectId(queueId);
    const queueEntry = await db
      .collection<GovernorQueuedBill>("governorLegislationQueue")
      .findOne({ _id: oid });
    if (!queueEntry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // The pending queue entry belongs to the office, not the individual who
    // created it, so any authorized officer of this office may cancel it.
    if (queueEntry.countryId !== countryId || queueEntry.stateId !== stateId) {
      return NextResponse.json({ error: "Queue entry not for this office" }, { status: 403 });
    }

    const result = await cancelQueue(db, oid, "manual");
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
