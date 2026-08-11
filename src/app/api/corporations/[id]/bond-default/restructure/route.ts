import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { executeCorporationBondRestructure } from "@/lib/bonds/executeCorporationBondRestructure";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";
import { getGameState } from "@/lib/gameState";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/bond-default/restructure
 * CEO-only. Liquidate the minimum set of sectors needed to repay defaulted
 * bondholders in full, then cure the defaulted bonds. The corporation survives.
 * Fails (400) when even liquidating every sector cannot cover the debt — the
 * CEO must then dissolve & settle instead.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();

    // Restructuring (selling sectors to settle bonds) is a corporation action:
    // blocked while an admin has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (corporation.countryOwnerId) {
      return NextResponse.json(
        { error: "Not available for national corporations" },
        { status: 400 }
      );
    }

    // The cure stamp's curedAtTurn and the bond_maturity ledger rows derive from
    // currentTurn; fail explicitly rather than leaking a turn=0 sentinel.
    const gameState = await getGameState();
    const cureTurn = gameState?.currentTurn ?? 0;
    if (cureTurn <= 0) {
      return NextResponse.json(
        { error: "Game state unavailable; restructuring cannot be processed." },
        { status: 503 }
      );
    }

    const now = new Date();
    const result = await withCorporationSettlementLock(
      db,
      corporation._id,
      "bondSettlementInProgressAt",
      now,
      async () => executeCorporationBondRestructure(db, corporation, { now, cureTurn })
    );

    if (!result) {
      return NextResponse.json(
        { error: "Bond settlement is already in progress for this corporation" },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      paid: result.paid,
      bondsMatured: result.bondsMatured,
      sectorsLiquidated: result.sectorsLiquidated,
      proceeds: result.proceeds,
      residualLiquidCapital: result.residualLiquidCapital,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
