import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryCountryBudget } from "@/lib/publicApi/nations";
import { publicError } from "@/lib/publicApi/errors";

// GET /api/public/v1/country/[code]/budget
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const guard = await publicApiGuard(request, "country-budget");
    if (!guard.ok) return guard.response;
    const { code } = await params;
    const result = await queryCountryBudget(await getDb(), code);
    if (!result) return publicError("INVALID_COUNTRY", "Invalid country code", 400);
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
