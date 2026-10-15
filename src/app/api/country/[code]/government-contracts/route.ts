import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { errorResponse } from "@/lib/api/errors";
import { contractContext, contractRouteError, privateJson } from "@/lib/governmentContracts/api";
import { publishTenderSchema } from "@/lib/governmentContracts/schemas";
import { publishTender } from "@/lib/governmentContracts/commands";
import { normalizePage } from "@/lib/governmentContracts/rules";
import { listGovernmentTenders } from "@/lib/governmentContracts/queries";
import type { TenderTab, ContractType } from "@/lib/governmentContracts/types";
type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { code } = await params;
    const { db, countryId, turn } = await contractContext(code);
    const q = new URL(request.url).searchParams;
    const tab = q.get("tab") ?? "active",
      type = q.get("type") ?? "all";
    if (
      !["active", "closed", "awarded", "canceled"].includes(tab) ||
      !["all", "defence", "extraction"].includes(type)
    )
      return errorResponse(400, "Invalid contract tab or type.");
    return privateJson(
      await listGovernmentTenders(
        db,
        countryId,
        tab as TenderTab,
        type === "all" ? undefined : (type as ContractType),
        normalizePage(q.get("page")),
        turn
      )
    );
  } catch (e) {
    return contractRouteError(e, request);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit("government-contracts:" + auth.user.userId, 20, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const parsed = await parseJsonBody(request, publishTenderSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { code } = await params;
    const { db, countryId, turn } = await contractContext(code);
    const id = await publishTender(db, countryId, parsed.data, auth.user, turn, new Date());
    return privateJson({ tenderId: id });
  } catch (e) {
    return contractRouteError(e, request);
  }
}
