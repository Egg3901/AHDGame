// POST /api/country/[code]/executive/cabinet/[positionId]/military/recruit
// Auth: requireAuth — must be the defense cabinet holder or admin. Costs 1 ministerial action.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { resolveGameYear } from "@/lib/era/era";
import { applyMilitaryRecruit } from "@/lib/military/recruit";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

const recruitSchema = z.object({
  branchId: z.string(),
  type: z.string(),
  name: z.string().min(1).max(80),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

// Crash-safe settlement (issue #1672): the ministerial-action, manpower,
// defence-appropriation, and arsenal writes plus the unit insert run as an
// exactly-once money flow under the client's `Idempotency-Key` (minted when
// absent). A retry with the same key replays the stored outcome instead of
// raising a second unit.
export async function POST(request: Request, { params }: RouteParams) {
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

    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, recruitSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    // Live year gates which branches/archetypes exist (e.g. Bundeswehr 1955,
    // USSF 2019). Prefer gameState.currentYear over the immutable seed year.
    const gameState = await getGameState();
    const liveYear = gameState ? resolveGameYear(gameState) : null;

    const db = await getDb();
    const result = await applyMilitaryRecruit(db, {
      countryId,
      positionId,
      branchId: parsed.data.branchId,
      type: parsed.data.type,
      name: parsed.data.name,
      actorCharacterId: auth.user.character != null ? String(auth.user.character._id) : "",
      isAdmin: auth.user.isAdmin === true,
      liveYear,
      currentTurn: gameState?.currentTurn ?? 1,
      preset: gameState?.preset ?? DEFAULT_SEED_PRESET,
      ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MoneyFlowTerminalError) {
      return NextResponse.json(
        { error: "Recruit already settled; start a new attempt with a new key." },
        { status: 409 }
      );
    }
    if (error instanceof MoneyFlowKeyConflictError) {
      return NextResponse.json(
        { error: "Idempotency key was reused for a different recruit." },
        { status: 409 }
      );
    }
    return handleRouteError(error);
  }
}
