import { assertSameOrigin } from "@/lib/api/assertSameOrigin";
import { recordAudit } from "@/lib/audit/recordAudit";
import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { groupManagementSchema } from "@/lib/corporations/groups/managementSchema";
import { groupManagementView, updateGroupManagement } from "@/lib/corporations/groups/management";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb(),
      { id } = await params,
      resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    return NextResponse.json({
      management: await groupManagementView(db, resolved.corporation, auth.user.userId),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const origin = assertSameOrigin(request);
    if (origin) return origin;
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit("group-management:" + auth.user.userId, 30, 60000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const parsed = await parseJsonBody(request, groupManagementSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const db = await getDb(),
      { id } = await params,
      resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const result = await updateGroupManagement(
      db,
      resolved.corporation,
      auth.user.userId,
      parsed.data
    );
    if (!result.ok) return errorResponse(result.status, result.error);
    recordAudit({
      source: "api",
      action: "corp.group." + parsed.data.action,
      category: "corp",
      subject: { type: "corporation", id: resolved.corporation._id.toString() },
      outcome: "ok",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
