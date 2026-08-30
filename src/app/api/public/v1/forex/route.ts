import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryForexRates } from "@/lib/publicApi/forex";

// GET /api/public/v1/forex
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "forex");
    if (!guard.ok) return guard.response;
    const result = await queryForexRates(await getDb());
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
