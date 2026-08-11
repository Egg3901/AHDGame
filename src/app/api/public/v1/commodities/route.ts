import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCommodities } from "@/lib/publicApi/commodities";

// GET /api/public/v1/commodities?country=CODE
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "commodities");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const country = url.searchParams.get("country") ?? undefined;

    const db = await getDb();
    const result = await queryCommodities(db, { country });
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
