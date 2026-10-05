/** Legacy player endpoint retained as an explicit migration boundary. */
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
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
      return errorResponse(403, "Player-run unions are not enabled.");
    }

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    return errorResponse(
      410,
      "Direct union-wide strikes were retired in 1.1. Open an employer bargaining campaign and escalate its dispute."
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
