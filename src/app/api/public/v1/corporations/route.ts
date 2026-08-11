import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCorporationList } from "@/lib/publicApi/corporation";

// GET /api/public/v1/corporations
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "corporation");
    if (!guard.ok) return guard.response;

    const db = await getDb();
    const corporations = await queryCorporationList(db);
    return NextResponse.json({ ok: true, corporations }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
