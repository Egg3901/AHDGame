// PUT /api/country/[code]/executive/cabinet/[positionId]/manpower
// Set the country's reinforcement mode (how under-strength units draw replacements).
// Auth: defense holder or admin. Gated by conflictsEnabled + defense seat.
// The enacted reserve law decides whether conscription is available at all — enforced
// here so the write boundary agrees with the turn step rather than silently downgrading.
// Errors: 400, 401, 403, 404.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { setNationalManpower } from "@/lib/db/collections/nationalManpower";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { resolveConscriptionStanceFor } from "@/lib/military/conscriptionLaw";

const bodySchema = z.object({ mode: z.enum(["off", "trained", "conscript"]) });

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
      return errorResponse(400, "Invalid country");
    }
    if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
      return errorResponse(404, "Not a defense cabinet position");
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const db = await getDb();
    const gsCol = await getGameStateCollection(db);
    const gs = await gsCol.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } });
    if (!gs?.conflictsEnabled) {
      return errorResponse(404, "Conflicts subsystem disabled");
    }

    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member?.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return errorResponse(403, "Only the defence minister may set the reinforcement mode.");
    }

    // Conscription is a legislated capability, not a cabinet toggle.
    if (parsed.data.mode === "conscript") {
      const stance = await resolveConscriptionStanceFor(db, countryId);
      if (!stance.conscriptAllowed) {
        return errorResponse(400, `${stance.label} does not permit conscription`);
      }
    }

    await setNationalManpower(db, countryId, { mode: parsed.data.mode });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
