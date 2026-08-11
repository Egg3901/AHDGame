// GET /api/country/[code]/executive/truces — live truces binding this country.
// Read-only and not sensitive: a truce is a public fact about two countries, and the
// declare-war panel needs it to state the bar rather than let a player discover it by
// being refused. Auth: any authenticated character.
// Errors: 400, 401, 404.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { listActiveTruces } from "@/lib/military/truce";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, currentTurn: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }
    const currentTurn = gs.currentTurn ?? 0;

    return NextResponse.json({
      currentTurn,
      truces: await listActiveTruces(db, countryId, currentTurn),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
