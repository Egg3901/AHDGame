/** Legacy player endpoint retained as an explicit migration boundary. */
import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isLabourFullMode } from "@/lib/labour/featureFlag";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, _context: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    return NextResponse.json(
      {
        error:
          "Direct union-wide strikes were retired in 1.1. Open an employer bargaining campaign and escalate its dispute.",
      },
      { status: 410 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
