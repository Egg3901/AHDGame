/**
 * POST /api/corporations/[id]/sectors/[sectorId]/union-busting — CEO attempts
 * to suppress a sector's unionization (Phase 7a). Cash cost + chance of
 * backfire — see `src/lib/labour/unionBusting.ts`. CEO only. Gated on
 * `labourSystemMode >= "full"`.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { attemptUnionBusting } from "@/lib/corporations/commands/sectorOperations/attemptUnionBusting";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Union-busting is not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const currentTurn = await getCurrentTurn(db);
    const result = await attemptUnionBusting(db, corporation, sectorId, currentTurn);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      bustingSucceeded: result.success,
      unionization: result.unionization,
      cashSpent: result.cashSpent,
      roll: result.roll,
      finalChance: result.finalChance,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
