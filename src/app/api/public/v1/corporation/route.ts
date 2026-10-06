import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCorporation } from "@/lib/publicApi/corporation";

// GET /api/public/v1/corporation?name=X or ?id=N
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "corporation");
    if (!guard.ok) return guard.response;

    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? undefined;
    const id = url.searchParams.get("id") ?? undefined;

    if (!name && !id) {
      return errorResponse(400, "Provide name or id", { code: "BAD_REQUEST", extra: { ok: false } });
    }

    const db = await getDb();
    const result = await queryCorporation(db, { name, id });

    if (!result) {
      return errorResponse(404, "Corporation not found", { code: "NOT_FOUND", extra: { ok: false } });
    }

    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
