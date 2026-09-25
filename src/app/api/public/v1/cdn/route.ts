import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { buildCdnCatalog } from "@/lib/publicApi/cdn";

// GET /api/public/v1/cdn
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "cdn");
    if (!guard.ok) return guard.response;

    return NextResponse.json({ ok: true, ...buildCdnCatalog() }, { headers: guard.headers });
  } catch (error) {
    return handleRouteError(error);
  }
}
