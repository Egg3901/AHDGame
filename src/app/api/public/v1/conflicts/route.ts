import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryConflicts } from "@/lib/publicApi/world";

// GET /api/public/v1/conflicts?country=CODE&status=&limit=
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "conflicts");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const db = await getDb();
    const result = await queryConflicts(db, {
      country: url.searchParams.get("country") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    });

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
