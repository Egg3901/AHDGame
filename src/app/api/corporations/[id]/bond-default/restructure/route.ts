import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { handleRouteError, internalError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { executeCorporationBondRestructure } from "@/lib/bonds/executeCorporationBondRestructure";
import {
  BOND_RESTRUCTURE_FUNDS,
  BOND_RESTRUCTURE_HOLDER,
  BOND_RESTRUCTURE_MATURE,
} from "@/lib/bonds/bondRestructureSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";
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
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // Crash-safe settlement (issue #1672): a client retry with the same key
    // replays the stored restructure outcome instead of paying again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

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
    // Map a keyed-settlement failure back onto the historical surface: a lost
    // cure race is the 400 bond-state refusal, a vanished holder or corp row
    // the 500 inconsistent error. The primitive already compensated any
    // applied prefix.
    let result: Awaited<ReturnType<typeof executeCorporationBondRestructure>> | null;
    try {
      result = await withCorporationSettlementLock(
        db,
        corporation._id,
        "bondSettlementInProgressAt",
        now,
        async () =>
          executeCorporationBondRestructure(db, corporation, {
            now,
            cureTurn,
            ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
          })
      );
    } catch (err) {
      if (err instanceof MoneyFlowTerminalError) {
        return NextResponse.json(
          { error: "Restructure already settled; start a new attempt with a new key." },
          { status: 409 }
        );
      }
      if (err instanceof MoneyFlowKeyConflictError) {
        return NextResponse.json(
          { error: "Idempotency key was reused for a different restructure." },
          { status: 409 }
        );
      }
      const message = err instanceof Error ? err.message : "";
      if (message.startsWith(BOND_RESTRUCTURE_MATURE)) {
        return NextResponse.json(
          { error: "Bond state changed during restructuring. Refresh and try again." },
          { status: 400 }
        );
      }
      if (
        message.startsWith(BOND_RESTRUCTURE_HOLDER) ||
        message.startsWith(BOND_RESTRUCTURE_FUNDS)
      ) {
        throw internalError("Bond holder data is inconsistent; contact an admin.");
      }
      throw err;
    }

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
