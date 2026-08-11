import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { bondDefaultDissolveSchema } from "@/lib/api/schemas/bondDefault";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { executeCorporationBondDefaultDissolution } from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  corporationDissolutionAgeBlock,
  dissolutionAgeBlockedMessage,
} from "@/lib/corporations/dissolutionAgeGuard";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/bond-default/dissolve
 * CEO-only. Dissolve the corporation: pay bondholders pro-rata from assets (LC + sector NPV),
 * then distribute remaining assets to shareholders pro-rata by shares.
 * Body: { "confirm": true }
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, bondDefaultDissolveSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    // Dissolving the corporation to resolve a bond default is a corporation
    // action: blocked while an admin has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const currentTurn = await getCurrentTurn(db);
    const ageBlock = corporationDissolutionAgeBlock(corporation.foundedAtTurn, currentTurn);
    if (ageBlock.blocked) {
      return NextResponse.json(
        { error: dissolutionAgeBlockedMessage(ageBlock.turnsRemaining) },
        { status: 400 }
      );
    }

    const now = new Date();
    const result = await withCorporationSettlementLock(
      db,
      corporation._id,
      "bondSettlementInProgressAt",
      now,
      async () =>
        executeCorporationBondDefaultDissolution(db, corporation, {
          requireDefaultedBonds: true,
        })
    );

    if (!result) {
      return NextResponse.json(
        { error: "Bond settlement is already in progress for this corporation" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      bondRecoveryPool: result.bondRecoveryPool,
      shareholderPool: result.shareholderPool,
      shareholderPayouts: result.shareholderPayouts,
      corporateShareholderPayouts: result.corporateShareholderPayouts,
      publicFloatPayout: result.publicFloatPayout,
      message: `${corporation.name} has been dissolved. Bondholders and shareholders were paid from liquid capital and sector NPV (see response for breakdown).`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
