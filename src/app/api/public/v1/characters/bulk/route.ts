import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCharactersBulk } from "@/lib/publicApi/character";

// GET /api/public/v1/characters/bulk?ids=1,7,42
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "characters-bulk");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const ids = url.searchParams.get("ids");
    if (!ids) {
      return NextResponse.json(
        { ok: false, error: "Missing required query param: ids", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const db = await getDb();
    const result = await queryCharactersBulk(db, ids);

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
