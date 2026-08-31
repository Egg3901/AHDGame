import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ENDPOINTS } from "@/lib/publicApi/catalog";
import { publicApiGuard } from "@/lib/publicApi/middleware";

export { ENDPOINTS } from "@/lib/publicApi/catalog";

// GET /api/public/v1/meta
export async function GET(request: Request) {
  try {
    const guard = await publicApiGuard(request, "meta");
    if (!guard.ok) return guard.response;

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
    return NextResponse.json(
      {
        ok: true,
        version: 1,
        baseUrl,
        docsUrl:
          process.env.NEXT_PUBLIC_DOCS_URL ||
          "https://docs.lakesidegames.net/api/public-v1.html",
        openApiUrl: `${baseUrl}/api/public/v1/openapi.json`,
        authentication: "X-API-Key header (public or private scope)",
        rateLimits: {
          publicRead: "60 req/min per key",
          transfers: "20 req/min per key (private scope only)",
          forex: "30 req/min per key (private scope only)",
          limitedResponse: "HTTP 429 + Retry-After header",
        },
        stability:
          "v1 is additive-only: fields may be added, existing fields are never removed or renamed.",
        writeEndpoints: ["POST /api/v1/transfer", "POST /api/v1/forex/exchange"],
        endpoints: ENDPOINTS,
      },
      { headers: guard.headers }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
