import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { querySovereignWatch } from "@/lib/publicApi/sovereigns";

// GET /api/public/v1/sovereigns
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "sovereigns");
    if (!guard.ok) return guard.response;
    const result = await querySovereignWatch(await getDb());
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
