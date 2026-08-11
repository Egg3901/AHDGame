import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getMacroCountryDiagnostics, MACRO_TICK_INTERVAL } from "@/lib/world/macro";

// GET /api/admin/macro-countries/diagnostics — Last macro tick + sector contributions.
// Auth: requireAdmin
// Errors: 401, 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const countries = await getMacroCountryDiagnostics(db);

    return NextResponse.json({
      macroTickInterval: MACRO_TICK_INTERVAL,
      countries,
      summary: {
        total: countries.length,
        withTick: countries.filter((c) => c.lastMacroTickTurn != null).length,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
