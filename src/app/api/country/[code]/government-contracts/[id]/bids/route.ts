import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { errorResponse } from "@/lib/api/errors";
import { contractContext, contractRouteError, privateJson } from "@/lib/governmentContracts/api";
import { bidSchema } from "@/lib/governmentContracts/schemas";
import { submitBid } from "@/lib/governmentContracts/commands";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit("government-contracts:" + auth.user.userId, 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const parsed = await parseJsonBody(request, bidSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { code, id } = await params;
    const { db, turn, tender } = await contractContext(code, id);
    await submitBid(db, tender!, parsed.data, auth.user, turn, new Date());
    return privateJson({ success: true });
  } catch (e) {
    return contractRouteError(e, request);
  }
}
