import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { errorResponse } from "@/lib/api/errors";
import { contractContext, contractRouteError, privateJson } from "@/lib/governmentContracts/api";
import { awardSchema } from "@/lib/governmentContracts/schemas";
import { awardTender } from "@/lib/governmentContracts/commands";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit("government-contracts:" + auth.user.userId, 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const parsed = await parseJsonBody(request, awardSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { code, id } = await params;
    const { db, turn, tender } = await contractContext(code, id);
    return privateJson({
      contractId: await awardTender(
        db,
        tender!,
        parsed.data.corporationId,
        parsed.data.reason,
        auth.user,
        turn,
        new Date()
      ),
    });
  } catch (e) {
    return contractRouteError(e, request);
  }
}
