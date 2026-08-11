import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCommodityDetail } from "@/lib/publicApi/commodities";

// GET /api/public/v1/commodity/[key]?country=CODE
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const guard = await publicApiGuard(request, "commodity");
    if (!guard.ok) return guard.response;

    const { key } = await params;
    const url = new URL(request.url);
    const country = url.searchParams.get("country") ?? undefined;

    const db = await getDb();
    const result = await queryCommodityDetail(db, { key, country });

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Unknown commodity key", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, found: true, commodity: result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
