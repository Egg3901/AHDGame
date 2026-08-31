import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { buildPublicV1OpenApiDocument } from "@/lib/publicApi/openapi";

// GET /api/public/v1/openapi.json
export async function GET(request: Request): Promise<Response> {
  try {
    const guard = await publicApiGuard(request, "openapi");
    if (!guard.ok) return guard.response;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
    return NextResponse.json(buildPublicV1OpenApiDocument(baseUrl), {
      headers: guard.headers,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
