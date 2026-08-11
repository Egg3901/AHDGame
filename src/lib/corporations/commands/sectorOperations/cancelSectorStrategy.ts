import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { CorporateSector, GameState, SectorBuildOrder } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  capacityRescaleRatio,
  rescaleBuildQueueForStrategyChange,
} from "@/lib/constants/capacityEconomy";
import { rescaleOtherOpexAnchorForRetool } from "@/lib/corporations/physicalPnl";
import { STRATEGY_TRANSITION_TURNS, CANCEL_COST_FRACTION } from "@/lib/constants/sectorStrategies";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  getSectorHostFxRate,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { insufficientCapitalMessage } from "@/lib/currency/insufficientCapitalMessage";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * POST /api/corporations/[id]/sectors/[sectorId]/strategy/cancel
 * Cancel an in-progress strategy transition, reversing it back to the original strategy.
 * auth: requireBasicAuth (CEO only)
 * errors: 400 (no transition, already reversing, insufficient funds), 404 (sector not found)
 *
 * Cost scales with progress: progress × 10% × daily revenue.
 * Reversal duration is proportional to elapsed progress.
 * Cannot cancel a reversal already in progress — must complete.
 */
export async function cancelSectorStrategy(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: new ObjectId(sectorId), corporationId: corporation._id });

    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    // Must have an active transition to cancel
    if (!sector.transitionFromStrategyId || sector.transitionStartTurn == null) {
      return NextResponse.json({ error: "No transition in progress to cancel" }, { status: 400 });
    }

    // Cannot cancel a reversal — must complete before changing strategy again
    if (sector.isReversing) {
      return NextResponse.json(
        { error: "Already reversing. Reversal must complete before changing strategy again." },
        { status: 400 }
      );
    }

    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;

    const elapsed = currentTurn - sector.transitionStartTurn;
    const progress = Math.min(1, Math.max(0, elapsed / STRATEGY_TRANSITION_TURNS));

    // Cost scales with how far into the transition we are — more progress = more to unwind.
    // sector.revenue is stored in the sector's HOST-state currency; normalize to
    // ₳ at the host rate. corpFxRate re-denominates on the liquidCapital $inc.
    const corpFxRate = await getCorpFxRate(db, corporation);
    const sectorHostRate = await getSectorHostFxRate(db, sector, corporation);
    const cancelCostAnchor = Math.round(
      progress *
        CANCEL_COST_FRACTION *
        readCorpEconomicAnchor(
          sector.revenue,
          resolveSectorHostCurrencyCode(sector, corporation),
          sectorHostRate
        )
    );
    const corpCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );
    if (corpCapitalAnchor < cancelCostAnchor) {
      return NextResponse.json(
        {
          error:
            insufficientCapitalMessage(
              "Cancellation",
              anchorToCorpLiquidCapital(cancelCostAnchor, corporation, corpFxRate),
              corporation.liquidCapital,
              resolveCorpLiquidCurrencyCode(corporation)
            ) + ` (${Math.round(progress * 100)}% progress × 10% of daily revenue).`,
        },
        { status: 400 }
      );
    }
    const cancelCostInCorpCapital = anchorToCorpLiquidCapital(
      cancelCostAnchor,
      corporation,
      corpFxRate
    );

    // Compute reversed transition fields:
    // Swap strategyId ↔ transitionFromStrategyId so the existing interpolation runs
    // in the opposite direction toward the original strategy.
    // Back-calculate transitionStartTurn so progress picks up at the same interpolation
    // point but now running backward.
    const reversalTurns = Math.max(1, Math.round(progress * STRATEGY_TRANSITION_TURNS));
    // Elapsed at cancel moment in the reversed transition = STRATEGY_TRANSITION_TURNS - reversalTurns
    const newTransitionStartTurn = currentTurn - (STRATEGY_TRANSITION_TURNS - reversalTurns);

    const newStrategyId = sector.transitionFromStrategyId; // the original strategy (destination of reversal)
    const newTransitionFromStrategyId = sector.strategyId; // what we were transitioning toward

    // D9: the same RPU normalization `setSectorStrategy` applies, run in the
    // opposite direction. The stock was rescaled to the DESTINATION's mix when
    // the transition was committed; cancelling makes the original strategy the
    // destination again, so rescale from `sector.strategyId` (the abandoned
    // destination) to `newStrategyId` (the original). Composing the two changes
    // returns the sector to exactly its pre-retool capacity — capacity is one
    // currency, and changing your mind must not mint or burn any of it.
    // PLANTS-GATED for the same reason as `setSectorStrategy`: below plants
    // `capitalStock` is production-gating state with a different meaning, and
    // rescaling it would move live output.
    //
    // The gate is the FLAG the retool persisted, not this request's mode. Each
    // command used to resolve `plantsEnabled` independently at its own call
    // time, so a retool committed under capital mode and cancelled after a flip
    // to plants applied the inverse ratio to a stock that was never scaled
    // forward — a permanent mint or burn of the entire RPU ratio, which reaches
    // 327x for a coal to rare-earth pair. The mode is still required as well: a
    // flip the OTHER way (retool under plants, cancel after a rollback to
    // capital) must not write plants-basis capacity onto a row capital mode now
    // owns. Only when both agree is the inverse both owed and safe. A legacy row
    // with no flag predates plants and was never rescaled, so it reads false.
    const marketMode = await getMarketSystemModeForDb(db);
    const plantsEnabled =
      marketAtLeast(marketMode, "plants") && sector.retoolRescaleApplied === true;
    const cancelRescaleRatio = capacityRescaleRatio(
      sector.sectorType as CorporationType,
      newTransitionFromStrategyId,
      newStrategyId
    );
    const rescaledCapitalStock =
      plantsEnabled &&
      typeof sector.capitalStock === "number" &&
      Number.isFinite(sector.capitalStock)
        ? sector.capitalStock * cancelRescaleRatio
        : null;
    const rescaledBuildQueue: SectorBuildOrder[] | null =
      plantsEnabled && Array.isArray(sector.buildQueue) && sector.buildQueue.length > 0
        ? rescaleBuildQueueForStrategyChange(sector.buildQueue, cancelRescaleRatio)
        : null;
    // P3.5: invert the retool's other-opex anchor rescale for the same reason,
    // on the same gate. `capacityRescaleRatio` composed with its reverse is the
    // identity, so a retool-then-cancel round trip returns the sector to its
    // original ₳-per-unit residual exactly.
    const rescaledCancelOtherOpexAnchor = plantsEnabled
      ? rescaleOtherOpexAnchorForRetool(sector.otherOpexPerUnitAnchor, cancelRescaleRatio)
      : null;

    await Promise.all([
      db
        .collection("corporations")
        .updateOne(
          { _id: corporation._id },
          { $inc: { liquidCapital: -cancelCostInCorpCapital }, $set: { updatedAt: new Date() } }
        ),
      db.collection<CorporateSector>("corporateSectors").updateOne(
        { _id: sector._id },
        {
          $set: {
            strategyId: newStrategyId,
            transitionFromStrategyId: newTransitionFromStrategyId,
            transitionStartTurn: newTransitionStartTurn,
            isReversing: true,
            ...(rescaledCapitalStock != null ? { capitalStock: rescaledCapitalStock } : {}),
            ...(rescaledBuildQueue != null ? { buildQueue: rescaledBuildQueue } : {}),
            ...(rescaledCancelOtherOpexAnchor != null
              ? { otherOpexPerUnitAnchor: rescaledCancelOtherOpexAnchor }
              : {}),
            updatedAt: new Date(),
          },
        }
      ),
    ]);

    return NextResponse.json({
      success: true,
      // cancelCost is returned in ₳; clients pair with corp.liquidCurrencyCode
      // to render via formatAmount(cancelCost, liquidCurrencyCode).
      cancelCost: cancelCostAnchor,
      reversalTurns,
      newStrategyId,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
