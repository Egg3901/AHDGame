// POST /api/country/[code]/executive/cabinet/[positionId]/intelligence/operation
//
// Run one intelligence operation. Collection buys coverage; action spends it.
// Every gate is checked before anything is spent, and the two rolls are drawn
// here so `runOperation` stays a pure orchestration over injected randomness.
//
// Auth: the intelligence seat holder or an admin. Errors: 400, 401, 403, 404, 409, 429
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCharactersCollection } from "@/lib/db/collections/characters";
import { runOperation } from "@/lib/intelligence/runOperation";
import {
  directorStatMultiplier,
  getOrCreateAgency,
  loadCurrentTurn,
  requireIntelligenceHolder,
  type IntelligenceRouteParams,
} from "../shared";

const bodySchema = z.object({
  targetCountryId: z.string().min(2).max(4),
  domain: z.enum(["strategic", "military", "economic"]),
  kind: z.enum(["collect", "action"]),
  opType: z.string().min(1).max(64),
});

export async function POST(request: Request, { params }: IntelligenceRouteParams) {
  try {
    const { code, positionId } = await params;
    const guard = await requireIntelligenceHolder(code, positionId);
    if ("error" in guard) return guard.error;
    const { db, countryId, member, user } = guard;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const targetCountryId = parsed.data.targetCountryId.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[targetCountryId]) {
      return NextResponse.json({ error: "Invalid target country" }, { status: 400 });
    }

    const turn = await loadCurrentTurn(db);
    const agency = await getOrCreateAgency(db, countryId, turn, member?.characterId ?? null);

    // A vacant seat resolves NEUTRAL rather than failing. Most countries have no
    // director, and a service that simply stopped would make the world inert.
    const director = agency.directorCharacterId
      ? await (
          await getCharactersCollection(db)
        ).findOne({ _id: agency.directorCharacterId }, { projection: { stats: 1 } })
      : null;

    const result = await runOperation({
      db,
      agency,
      targetCountryId,
      domain: parsed.data.domain,
      kind: parsed.data.kind,
      opType: parsed.data.opType,
      turn,
      statMultiplier: directorStatMultiplier(director?.stats),
      actorUserId: user.userId ?? null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // The acting service's own view. `rollDetail` never leaves the server.
    return NextResponse.json({
      outcome: result.outcome,
      compromise: result.compromise,
      coverage: result.coverage,
      networkLevel: result.networkLevel,
      networkStatus: result.networkStatus,
      message: result.message,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
