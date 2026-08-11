// GET /api/country/[code]/command-economy
// Command Economy v2 (P2) dashboard payload: regime + marketization gauge with
// its three live drivers, the SOE list with plan fulfillment, the Gosbank
// stance, the seat holders, and which seats the viewer holds.
// Auth: public read (viewer role flags require a character). Returns 404 when
// the country is not a flag-on planned economy.
import { NextResponse } from "next/server";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getDb } from "@/lib/mongodb";
import { loadCommandEconomyDashboard } from "@/lib/economy/queries/loadCommandEconomyDashboard";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });
    }

    const user = await getAuthUserWithCharacter();
    const viewerCharacterId = user?.character?._id ?? null;

    const db = await getDb();
    const dashboard = await loadCommandEconomyDashboard(db, countryId, viewerCharacterId);
    if (!dashboard) {
      return NextResponse.json(notFound("This country does not run a command economy.").toJson(), {
        status: 404,
      });
    }

    return NextResponse.json(dashboard, {
      headers: { "Cache-Control": "no-store, max-age=0, no-transform" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
