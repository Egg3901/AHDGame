// POST /api/country/[code]/executive/cabinet/[positionId]/intelligence/counter-intel
//
// Set the service's defensive posture. This shades how likely a foreign operation
// against this country is to be caught, and how far up the ladder a catch goes.
//
// Note this is the PLAYER surface only. NPP countries have their posture derived
// every turn by the intelligence phase, because defence needs no order.
//
// Auth: the intelligence seat holder or an admin. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getIntelligenceAgenciesCollection } from "@/lib/db/collections/intelligence";
import { COUNTER_INTEL_MAX } from "@/lib/intelligence/config";
import {
  getOrCreateAgency,
  loadCurrentTurn,
  requireIntelligenceHolder,
  type IntelligenceRouteParams,
} from "../shared";

const bodySchema = z.object({
  counterIntel: z.number().int().min(0).max(COUNTER_INTEL_MAX),
});

export async function POST(request: Request, { params }: IntelligenceRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireIntelligenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId, member } = guard;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const turn = await loadCurrentTurn(db);
    const agency = await getOrCreateAgency(db, countryId, turn, member?.characterId ?? null);

    const agencies = await getIntelligenceAgenciesCollection(db);
    await agencies.updateOne(
      { _id: agency._id },
      { $set: { counterIntel: parsed.data.counterIntel, updatedAt: new Date() } }
    );

    return NextResponse.json({ counterIntel: parsed.data.counterIntel });
  } catch (error) {
    return handleRouteError(error);
  }
}
