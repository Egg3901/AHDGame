import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryLegislature } from "@/lib/publicApi/economy";

// GET /api/public/v1/country/[code]/legislature
// Auth: PUBLIC_BOT_API_KEY
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const guard = await publicApiGuard(request, "legislature");
    if (!guard.ok) return guard.response;

    const { code } = await params;
    const db = await getDb();
    const result = await queryLegislature(db, code.toUpperCase());

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "Country not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
