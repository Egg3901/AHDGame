/**
 * POST /api/corporations/[id]/sectors/[sectorId]/abandon
 * Abandon a sector. Deletes the sector; revenue returns to the unowned pool.
 * CEO only.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { CorporateSector, GameState, SectorBuildOrder, State } from "@/lib/db/types";
import type { Corporation } from "@/lib/db/types";
import { CAPACITY_BUILD_CANCEL_REFUND } from "@/lib/constants/capacityEconomy";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { emitBuildCapexTx } from "@/lib/corporations/capexTxLog";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { restoreSectorsToUnowned } from "@/lib/corporations/restoreSectorsToUnowned";
import { applyBrandFacilityLoss } from "@/lib/corporations/brandFacilityLoss";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

export async function abandonSector(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const db = await getDb();

    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    // Claim the sector row up front by deleting it atomically. The build-order
    // cash refund below is an unguarded `$inc` on liquidCapital; without a claim,
    // N concurrent abandons of the same sector each `findOne` it before any
    // delete lands and each pays the refund, minting 0.75×CIP per extra racer
    // (the pool restore and row delete are already idempotent — only the cash
    // leg is not). findOneAndDelete lets exactly one request win; the losers see
    // null and refund nothing. The returned doc carries the buildQueue we need.
    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOneAndDelete({ _id: new ObjectId(sectorId), corporationId: corporation._id });

    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    const sectorLabel =
      CORPORATION_TYPE_LABELS[sector.sectorType as keyof typeof CORPORATION_TYPE_LABELS] ??
      sector.sectorType;
    const state = await db
      .collection<State>("states")
      .findOne({ _id: sector.stateId }, { projection: { name: 1 } });
    const stateName = state?.name ?? sector.stateId;
    const now = new Date();

    // Brand facility-loss (Boeing rule): the corp is voluntarily shedding this
    // sector, so dent its brand proportional to the sector's share of the corp's
    // revenue. Called while the corp still owns it (aggregate includes it). No-op
    // when the corp has no loyalty. Best-effort — loyalty recomputes each turn.
    await applyBrandFacilityLoss(db, corporation._id, sector.revenue);

    // ─── In-flight build orders (plants tier) ────────────────────────────────
    // Abandoning a sector destroys its `buildQueue` along with the row. Those
    // orders are cash the CEO has already paid, sitting in CIP. Forfeiting it
    // would make "abandon" a strictly worse cancel AND a silent money burn the
    // shadow ledger cannot attribute, so undelivered orders are cancelled here
    // on exactly the terms the cancel command gives them:
    // CAPACITY_BUILD_CANCEL_REFUND (0.75) of what was paid, with the matching
    // capex refund leg. Orders that have already landed refund nothing — their
    // capacity is in `capitalStock` and goes back to the pool with the rest.
    const queue: SectorBuildOrder[] = Array.isArray(sector.buildQueue) ? sector.buildQueue : [];
    if (queue.length > 0) {
      const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      const currentTurn = gameState?.currentTurn ?? 0;
      const refundableAnchor = queue
        .filter((order) => order.onlineTurn > currentTurn)
        .reduce(
          (sum, order) =>
            sum +
            (Number.isFinite(order.costPaidAnchor) ? Math.max(0, order.costPaidAnchor) : 0) *
              CAPACITY_BUILD_CANCEL_REFUND,
          0
        );
      if (refundableAnchor > 0) {
        const corpFxRate = await getCorpFxRate(db, corporation);
        const refundLocal = Math.round(
          anchorToCorpLiquidCapital(refundableAnchor, corporation, corpFxRate)
        );
        if (refundLocal > 0) {
          await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: corporation._id },
              { $inc: { liquidCapital: refundLocal }, $set: { updatedAt: now } }
            );
        }
        // Best-effort ledger leg, same discipline as the cancel command: the
        // cash has moved, so a log failure must not 500 the caller into a retry
        // that would double-refund.
        await emitBuildCapexTx(db, {
          corporationId: corporation._id,
          corporationName: corporation.name,
          corporationSequentialId: corporation.sequentialId,
          direction: "refund",
          amountLocal: Math.abs(refundLocal),
          currencyCode: resolveCorpLiquidCurrencyCode(corporation) ?? "USD",
          anchorAmount: refundableAnchor,
          turn: currentTurn,
          createdAt: now,
          sectorId: sector._id,
          sectorType: sector.sectorType,
          units: queue.reduce((sum, o) => sum + (o.unitsOrdered ?? 0), 0),
          meta: { reason: "abandonSector" },
        }).catch(() => {});
      }
    }

    const restoreResult = await restoreSectorsToUnowned(db, [sector], now);

    return NextResponse.json({
      success: true,
      message: `Abandoned ${sectorLabel} sector in ${stateName}. $${Math.round(restoreResult.totalRevenueRestored).toLocaleString()}/day returned to the unowned pool.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
