import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { errorResponse } from "@/lib/api/errors";
import { contractContext, contractRouteError, privateJson } from "@/lib/governmentContracts/api";
import { cancelSchema } from "@/lib/governmentContracts/schemas";
import { cancelTender } from "@/lib/governmentContracts/commands";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit("government-contracts:" + auth.user.userId, 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const parsed = await parseJsonBody(request, cancelSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { code, id } = await params;
    const { db, turn, tender } = await contractContext(code, id);
    await cancelTender(db, tender!, parsed.data.reason, auth.user, turn);
    return privateJson({ success: true });
  } catch (e) {
    return contractRouteError(e, request);
  }
}
