import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryLegislation } from "@/lib/publicApi/legislation";

// GET /api/public/v1/legislation?country=CODE&status=pending|passed|failed&limit=N
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "legislation");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const country = url.searchParams.get("country") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 100);

    const db = await getDb();
    const result = await queryLegislation(db, { country, status, limit });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
