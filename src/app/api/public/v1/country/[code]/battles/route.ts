import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryBattleReports } from "@/lib/publicApi/world";

// GET /api/public/v1/country/[code]/battles?limit=
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const guard = await publicApiGuard(request, "country-battles");
    if (!guard.ok) return guard.response;

    const { code } = await params;
    const url = new URL(request.url);
    const db = await getDb();
    const result = await queryBattleReports(
      db,
      code.toUpperCase(),
      url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined
    );

    return NextResponse.json(
      { ok: true, countryId: code.toUpperCase(), ...result },
      { headers: guard.headers }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
