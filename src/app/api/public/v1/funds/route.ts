import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryIndexFunds, queryIndexFundDetail } from "@/lib/publicApi/funds";

// GET /api/public/v1/funds?country=CODE&scope=   — list funds
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "funds");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");
    const db = await getDb();

    if (slug) {
      const detail = await queryIndexFundDetail(db, slug);
      if (!detail) {
        return NextResponse.json(
          { ok: false, error: "Fund not found", code: "NOT_FOUND" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, ...detail }, { headers: guard.headers });
    }

    const result = await queryIndexFunds(db, {
      country: url.searchParams.get("country") ?? undefined,
      scope: url.searchParams.get("scope") ?? undefined,
    });

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
