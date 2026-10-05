import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCountrySummary } from "@/lib/publicApi/economy";

// GET /api/public/v1/country/[code]
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const guard = await publicApiGuard(request, "country");
    if (!guard.ok) return guard.response;

    const { code } = await params;
    const db = await getDb();
    const result = await queryCountrySummary(db, code.toUpperCase());

    if (!result) {
      return errorResponse(404, "Country not found", { code: "NOT_FOUND", extra: { ok: false } });
    }

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
