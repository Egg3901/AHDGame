import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { getGameState } from "@/lib/gameState";
import { isRedistrictingEnabled } from "@/lib/redistricting/flag";
import { regenerateCongressionalDistricts } from "@/lib/redistricting/regenerate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { regionRedistrictUrl } from "@/lib/urls";

// POST /api/admin/country/[code]/region/[id]/redistrict/trigger — reset a state's
// district map to a neutral baseline and open it for manual redraw.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const stateId = id.toUpperCase();
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    if (countryId !== "US") {
      return NextResponse.json(
        { error: "Redistricting is only available for US states" },
        { status: 400 }
      );
    }

    const gs = await getGameState();
    if (!isRedistrictingEnabled(gs)) {
      return NextResponse.json(
        { error: "Redistricting is not enabled — turn it on in the admin dashboard first" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const now = new Date();
    const { regenerated } = await regenerateCongressionalDistricts(db, {
      countryId,
      stateIds: [stateId],
      now,
    });
    if (regenerated === 0) {
      return NextResponse.json(
        { error: "No districts were generated for this state" },
        { status: 400 }
      );
    }

    console.log(
      `[Admin] ${auth.admin.username} triggered redistricting for ${stateId} (${regenerated} districts reset)`
    );

    return NextResponse.json({
      success: true,
      message: `Reset ${regenerated} district(s) for ${stateId}. You can now redraw the map.`,
      redirectUrl: regionRedistrictUrl(countryId, stateId),
      regenerated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
