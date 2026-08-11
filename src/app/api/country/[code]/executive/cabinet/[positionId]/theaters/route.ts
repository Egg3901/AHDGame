// PUT /api/country/[code]/executive/cabinet/[positionId]/theaters
// Save the country's World Situation Board state (war-footing cohesion + per-theater
// combat-power commitments). Auth: defense holder or admin. Gated by conflictsEnabled +
// defense seat. Client-authoritative (commitments grant no resources) with light server
// validation — the server recomputes the live-unit pool and rejects over-commitment.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getTheaterStateCollection } from "@/lib/db/collections/theaterState";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { theaterPool } from "@/lib/military/theaterPool";

const bodySchema = z.object({
  cohesion: z.number(),
  committed: z.record(z.string(), z.number()),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const gsCol = await getGameStateCollection(db);
    const gs = await gsCol.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the defence minister may commit forces." },
        { status: 403 }
      );
    }

    // Normalize + validate the commitment map: live conflicts only, non-negative.
    const validTheaters = new Set((await listActiveConflicts(db)).map((c) => c._id));
    const committed: Record<string, number> = {};
    let sum = 0;
    for (const [id, v] of Object.entries(parsed.data.committed)) {
      if (!validTheaters.has(id)) {
        return NextResponse.json({ error: "Invalid theater" }, { status: 400 });
      }
      const n = Math.max(0, Math.round(v));
      committed[id] = n;
      sum += n;
    }

    // The pool is authoritative — recompute it from the country's live units.
    const units = await getMilitaryUnitsCollection(db).find({ countryId }).toArray();
    if (sum > theaterPool(units)) {
      return NextResponse.json(
        { error: "Commitment exceeds available combat power" },
        { status: 400 }
      );
    }

    const cohesion = Math.max(40, Math.min(100, Math.round(parsed.data.cohesion)));

    await getTheaterStateCollection(db).updateOne(
      { countryId },
      { $set: { cohesion, committed }, $setOnInsert: { countryId } },
      { upsert: true }
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
