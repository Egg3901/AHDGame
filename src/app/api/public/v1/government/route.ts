import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryGovernment } from "@/lib/publicApi/government";

// GET /api/public/v1/government?country=CODE
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "government");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const country = url.searchParams.get("country");

    if (!country) {
      return errorResponse(400, "country is required", { code: "BAD_REQUEST", extra: { ok: false } });
    }

    const db = await getDb();
    const result = await queryGovernment(db, country);

    if (!result) {
      return errorResponse(404, "Country not found", { code: "NOT_FOUND", extra: { ok: false } });
    }

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
