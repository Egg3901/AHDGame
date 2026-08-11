// GET /api/prospecting?stateId=&corporationId=&countryId= - List prospecting surveys.
// Auth: public read (active + last 50 resolved), no secrets projected.
// Errors: 400

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getProspectingSurveysCollection } from "@/lib/db/collections/prospectingSurveys";
import type { ProspectingSurvey } from "@/lib/db/types/prospectingSurvey";

// initiatorUserId is intentionally omitted — it identifies the player who acted.
const PUBLIC_PROJECTION = {
  initiatorType: 1,
  corporationId: 1,
  countryId: 1,
  stateId: 1,
  resource: 1,
  startedTurn: 1,
  completesTurn: 1,
  costAnchor: 1,
  status: 1,
  capacityGained: 1,
  resolvedTurn: 1,
} as const;

function shape(s: Partial<ProspectingSurvey> & { _id: ObjectId }) {
  return {
    ...s,
    _id: s._id.toString(),
    corporationId: s.corporationId ? s.corporationId.toString() : undefined,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("stateId");
    const corporationId = searchParams.get("corporationId");
    const countryId = searchParams.get("countryId");

    if (corporationId && !ObjectId.isValid(corporationId)) {
      return NextResponse.json({ error: "Invalid corporationId" }, { status: 400 });
    }

    const base: Record<string, unknown> = {};
    if (stateId) base.stateId = stateId;
    if (countryId) base.countryId = countryId;
    if (corporationId) base.corporationId = new ObjectId(corporationId);

    const db = await getDb();
    const col = await getProspectingSurveysCollection(db);

    const [active, resolved] = await Promise.all([
      col
        .find({ ...base, status: "active" }, { projection: PUBLIC_PROJECTION })
        .sort({ completesTurn: 1 })
        .toArray(),
      col
        .find(
          { ...base, status: { $in: ["succeeded", "failed"] } },
          { projection: PUBLIC_PROJECTION }
        )
        .sort({ resolvedTurn: -1 })
        .limit(50)
        .toArray(),
    ]);

    return NextResponse.json({
      active: active.map(shape),
      resolved: resolved.map(shape),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
