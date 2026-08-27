import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCountryHistory } from "@/lib/publicApi/world";

// GET /api/public/v1/country/[code]/history?limit=&type=&beforeTurn=
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const guard = await publicApiGuard(request, "country-history");
    if (!guard.ok) return guard.response;

    const { code } = await params;
    const url = new URL(request.url);
    const db = await getDb();
    const result = await queryCountryHistory(db, code.toUpperCase(), {
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      type: url.searchParams.get("type") ?? undefined,
      beforeTurn: url.searchParams.get("beforeTurn")
        ? Number(url.searchParams.get("beforeTurn"))
        : undefined,
    });

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
