import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import {
  MAX_BRANCH_CAPACITY_SHARE,
  MIN_BRANCH_CAPACITY_SHARE,
  setBranchCapacityShare,
} from "@/lib/banking/capacityAllocation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const capacitySchema = z.object({
  branchCapacityShare: z
    .number()
    .finite()
    .min(MIN_BRANCH_CAPACITY_SHARE)
    .max(MAX_BRANCH_CAPACITY_SHARE),
});

// PUT /api/corporations/[id]/bank/capacity — Set branch capacity share (CEO).
// Auth: requireAuth (CEO)
// Errors: 400, 401, 403, 404
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    if (!(await isPrivateBankingEnabled())) {
      throw notFound("Not found");
    }

    const { id } = await params;
    const parsed = await parseJsonBody(request, capacitySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const result = await setBranchCapacityShare(
      db,
      corporation._id,
      parsed.data.branchCapacityShare
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      branchCapacityShare: result.branchCapacityShare,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
