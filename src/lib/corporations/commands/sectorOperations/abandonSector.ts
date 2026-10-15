/**
 * POST /api/corporations/[id]/sectors/[sectorId]/abandon
 * Abandon a sector. Deletes the sector; revenue returns to the unowned pool.
 * CEO only.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { CorporateSector, GameState, SectorBuildOrder, State } from "@/lib/db/types";
import type { Corporation } from "@/lib/db/types";
import { queueUndeliveredCost, undeliveredUnits } from "@/lib/corporations/buildDelivery";
import { CAPACITY_BUILD_CANCEL_REFUND } from "@/lib/constants/capacityEconomy";
import {
  anchorToCorpLiquidCapital,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { emitBuildCapexTx } from "@/lib/corporations/capexTxLog";
import { OPERATING_SECTOR_TYPE_LABELS } from "@/lib/constants/corporations";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { disposeLeavingSectors } from "@/lib/corporations/nppPickup";
import { applyBrandFacilityLoss } from "@/lib/corporations/brandFacilityLoss";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { unprotectedConstructionPropertyFilter } from "@/lib/corporations/securedConstructionProperty";
import { abandonBankImpact } from "@/lib/banking/capacityAllocation";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

export async function abandonSector(request: Request, { params }: RouteParams) {
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
      return errorResponse(400, "Invalid sector ID");
    }

    // A financial sector feeds a deposit-taking bank's branch network. Abandoning
    // one lowers the deposit ceiling (to zero with the last one), so the CEO sees
    // the impact and confirms it first (ticket 1553).
    const preview = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne(
        { _id: new ObjectId(sectorId), corporationId: corporation._id },
        { projection: { sectorType: 1 } }
      );
    if (preview) {
      const impact = await abandonBankImpact(db, corporation, preview);
      const body = (await request.json().catch(() => null)) as {
        acknowledgeBankImpact?: unknown;
      } | null;
      if (
        impact &&
        impact.ceilingAfter < impact.ceilingBefore &&
        body?.acknowledgeBankImpact !== true
      ) {
        return errorResponse(
          409,
          impact.lastFinancialSector
            ? "This is your last financial sector. Your bank's deposit capacity comes only from financial sectors, so abandoning it cuts the deposit ceiling to zero: the bank takes no new deposits and existing deposits drain away each turn until you own a financial sector again."
            : "Your bank's deposit capacity comes from your financial sectors. Abandoning this one lowers the deposit ceiling, and deposits above the new ceiling drain away each turn.",
          { code: "BANK_CAPACITY_IMPACT", extra: { bankImpact: impact } }
        );
      }
    }

    // Reserve the sector without deleting it. The property marker makes this
    // the one abandon winner, excludes a concurrent construction claim, and
    // lets the idempotent pool restore delete only after its credit is durable.
    // The returned snapshot carries the queue needed for the one-time refund.
    const transitionKey = `restore:${new ObjectId(sectorId).toHexString()}`;
    const sector = await db.collection<CorporateSector>("corporateSectors").findOneAndUpdate(
      {
        _id: new ObjectId(sectorId),
        corporationId: corporation._id,
        ...unprotectedConstructionPropertyFilter(),
      },
      {
        $set: {
          constructionPropertyTransition: { key: transitionKey, kind: "restore" },
        },
      },
      { returnDocument: "after" }
    );

    if (!sector) {
      return errorResponse(404, "Sector not found");
    }

    const sectorLabel =
      OPERATING_SECTOR_TYPE_LABELS[
        sector.sectorType as keyof typeof OPERATING_SECTOR_TYPE_LABELS
      ] ?? sector.sectorType;
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
      const refundableAnchor =
        queueUndeliveredCost(queue, currentTurn) * CAPACITY_BUILD_CANCEL_REFUND;
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
          units: queue.reduce((sum, o) => sum + undeliveredUnits(o, currentTurn), 0),
          meta: { reason: "abandonSector" },
        }).catch(() => {});
      }
    }

    // An NPP operator takes over most of the built capacity so the market keeps
    // its supply; the rest, and any undelivered orders, return to the pool.
    const disposal = await disposeLeavingSectors(db, corporation, [sector], now);

    return NextResponse.json({
      success: true,
      message:
        disposal.recipientIds.length > 0
          ? `Abandoned ${sectorLabel} sector in ${stateName}. An NPP operator took over most of its plants; the rest of the market reopens to builders.`
          : `Abandoned ${sectorLabel} sector in ${stateName}. Its market reopens to builders.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
