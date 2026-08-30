import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryOrganizations } from "@/lib/publicApi/organizations";

// GET /api/public/v1/organizations
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "organizations");
    if (!guard.ok) return guard.response;
    const result = await queryOrganizations(await getDb());
    return NextResponse.json({ ok: true, ...result }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
