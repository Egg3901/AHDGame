import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCountries } from "@/lib/publicApi/nations";

// GET /api/public/v1/country
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "countries");
    if (!guard.ok) return guard.response;
    const result = await queryCountries(await getDb());
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
