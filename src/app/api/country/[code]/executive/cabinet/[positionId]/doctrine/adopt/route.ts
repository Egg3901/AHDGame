// POST /api/country/[code]/executive/cabinet/[positionId]/doctrine/adopt
// Adopt a national-doctrine node. Auth: defense holder or admin. Gated by
// conflictsEnabled + defense seat. Server re-validates via adoptNode (never
// trusts the client). Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import {
  getNationalDoctrine,
  getNationalDoctrineCollection,
  settleDoctrineIncome,
} from "@/lib/db/collections/nationalDoctrine";
import { resolveDoctrineEra } from "@/lib/military/currentDoctrineEra";
import { resolveGameYear } from "@/lib/era/era";
import { adoptNode } from "@/lib/military/doctrineTree";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";

const adoptSchema = z.object({ key: z.string().min(1) });

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return errorResponse(404, "Not a defense cabinet position");
    }

    const parsed = await parseJsonBody(request, adoptSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const gsCol = await getGameStateCollection(db);
    const gs = await gsCol.findOne(
      { _id: "current" },
      { projection: { conflictsEnabled: 1, currentYear: 1, currentTurn: 1, startingYear: 1 } }
    );
    if (!gs?.conflictsEnabled) {
      return errorResponse(404, "Conflicts subsystem disabled");
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the defence minister may adopt a doctrine.");
    }

    // Doctrine outlives the appointment: an adopted node stays adopted after the
    // acting holder is replaced.
    const actingDenied = requireConfirmedSecretary(member, "doctrine", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const currentEra = await resolveDoctrineEra(db);
    const year = resolveGameYear(gs);
    const current =
      year != null && gs.startingYear != null
        ? await settleDoctrineIncome(db, countryId, gs.startingYear, year)
        : await getNationalDoctrine(db, countryId);
    const res = adoptNode(current, parsed.data.key, currentEra);
    if (!res.changed) {
      return NextResponse.json({ error: res.reason ?? "Cannot adopt" }, { status: 400 });
    }

    await getNationalDoctrineCollection(db).updateOne(
      { countryId },
      {
        $set: { adopted: res.state.adopted, points: res.state.points },
        $setOnInsert: { countryId },
      },
      { upsert: true }
    );

    return NextResponse.json({ adopted: res.state.adopted, points: res.state.points });
  } catch (error) {
    return handleRouteError(error);
  }
}
