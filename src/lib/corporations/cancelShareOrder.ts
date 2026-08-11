import type { Db } from "mongodb";
import type { Character, Corporation, ShareOrder } from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  buildPersonalBalanceInc,
  getHomeCurrency,
  loadCharacterFxRate,
} from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { creditShares, creditSharesToCorp } from "@/lib/corporations/shareholderOps";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { cancelFundShareOrder } from "@/lib/indexFunds/fundShareOrders";

type CancelResult = { ok: true } | { ok: false; error: string };

async function restoreOrderToOpen(db: Db, orderId: ShareOrder["_id"]) {
  await db
    .collection<ShareOrder>("shareOrders")
    .updateOne(
      { _id: orderId, status: "cancelled" },
      { $set: { status: "open", updatedAt: new Date() } }
    );
}

/**
 * Cancel an open share order and refund the escrow / reserved shares.
 *
 * Used by:
 * - DELETE /api/corporations/[id]/shares/orders/[orderId] (player-initiated cancel)
 * - POST /api/corporations/[id]/shares/consolidate        (auto-cancel before restructure)
 */
export async function cancelShareOrderAndRefund(db: Db, order: ShareOrder): Promise<CancelResult> {
  if (order.status !== "open") return { ok: false, error: "Order is not open" };

  const now = new Date();

  if (order.type === "buy") {
    const targetCorp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: order.corporationId });
    if (!targetCorp) {
      return { ok: false, error: "Target corporation not found" };
    }

    const targetFxRate = await getCorpFxRate(db, targetCorp);
    const refundAnchor = corpLiquidCapitalToAnchor(order.escrowAmount, targetCorp, targetFxRate);
    const currentTurn = await getCurrentTurn(db);

    if (order.placerCorporationId) {
      const placerCorp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: order.placerCorporationId });
      if (!placerCorp) {
        // Mirror the orphan-buyer fallback below: if the placer corp has been
        // dissolved/deleted, the escrow can't be refunded — but leaving the
        // order open blocks restructures and market maintenance on the target.
        // Cancel without refund and move on.
        const claim = await db
          .collection<ShareOrder>("shareOrders")
          .updateOne(
            { _id: order._id, status: "open" },
            { $set: { status: "cancelled", updatedAt: now } }
          );
        if (claim.matchedCount === 0) return { ok: false, error: "Order is not open" };
        return { ok: true };
      }

      const placerFxRate = await getCorpFxRate(db, placerCorp);
      const refundInPlacerCapital = anchorToCorpLiquidCapital(
        refundAnchor,
        placerCorp,
        placerFxRate
      );

      const claim = await db
        .collection<ShareOrder>("shareOrders")
        .updateOne(
          { _id: order._id, status: "open" },
          { $set: { status: "cancelled", updatedAt: now } }
        );
      if (claim.matchedCount === 0) return { ok: false, error: "Order is not open" };

      try {
        const refundResult = await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: order.placerCorporationId },
            { $inc: { liquidCapital: refundInPlacerCapital }, $set: { updatedAt: now } }
          );
        if (refundResult.matchedCount === 0) {
          throw new Error("Buyer corporation not found");
        }

        void emitTx(db, {
          type: "stock_order_refund",
          turn: currentTurn,
          createdAt: now,
          subjectType: "corporation",
          subjectId: order.placerCorporationId,
          subjectName: placerCorp.name,
          amount: Math.round(refundInPlacerCapital * 100) / 100,
          currencyCode: resolveCorpLiquidCurrencyCode(placerCorp) ?? "USD",
          counterpartyType: "system",
          counterpartyName: "Order book escrow",
          meta: {
            orderId: order._id.toString(),
            orderType: order.type,
            targetCorporationId: order.corporationId.toString(),
            escrowAmountAnchor: Math.round(refundAnchor * 100) / 100,
          },
        });
      } catch (error) {
        await restoreOrderToOpen(db, order._id);
        return { ok: false, error: (error as Error).message || "Failed to refund corporation" };
      }

      return { ok: true };
    }

    // Index-fund-owned buy orders refund anchor escrow to the fund cashAnchor.
    if (order.placerFundId) {
      await cancelFundShareOrder(db, order._id);
      return { ok: true };
    }

    if (!order.characterId) {
      return { ok: false, error: "Order has no owner to refund" };
    }
    const orderCharacterId = order.characterId;

    let charDoc = await db
      .collection<Character>("characters")
      .findOne({ _id: orderCharacterId }, { projection: { countryId: 1, name: 1 } });
    let collectionName: "characters" | "imperialCharacters" = "characters";
    if (!charDoc) {
      const imperialDoc = await db
        .collection<ImperialCharacter>("imperialCharacters")
        .findOne({ _id: order.characterId }, { projection: { countryId: 1, name: 1 } });
      if (imperialDoc) {
        charDoc = imperialDoc as unknown as Character;
        collectionName = "imperialCharacters";
      }
    }
    if (!charDoc) {
      // Preserve cleanup flows even when the buyer record has already been deleted.
      // The escrow is no longer recoverable, but leaving the order open blocks
      // restructures and market maintenance on an otherwise orphaned document.
      const claim = await db
        .collection<ShareOrder>("shareOrders")
        .updateOne(
          { _id: order._id, status: "open" },
          { $set: { status: "cancelled", updatedAt: now } }
        );
      if (claim.matchedCount === 0) return { ok: false, error: "Order is not open" };
      return { ok: true };
    }

    const forexEnabled = await isForexEnabled();
    const homeCurrency = getHomeCurrency(charDoc as unknown as { countryId: string });
    let charFxRate = 1.0;
    if (forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, homeCurrency);
      if (!fxResult.ok) {
        return { ok: false, error: "Exchange rate unavailable, try again shortly" };
      }
      charFxRate = fxResult.rate;
    }
    const refundInHome = refundAnchor * charFxRate;

    const claim = await db
      .collection<ShareOrder>("shareOrders")
      .updateOne(
        { _id: order._id, status: "open" },
        { $set: { status: "cancelled", updatedAt: now } }
      );
    if (claim.matchedCount === 0) return { ok: false, error: "Order is not open" };

    try {
      const refundResult = await db.collection(collectionName).updateOne(
        { _id: orderCharacterId },
        {
          $inc: buildPersonalBalanceInc(refundInHome, homeCurrency, forexEnabled),
          $set: { updatedAt: now },
        }
      );
      if (refundResult.matchedCount === 0) {
        throw new Error("Order owner not found");
      }

      void emitTx(db, {
        type: "stock_order_refund",
        turn: currentTurn,
        createdAt: now,
        subjectType: "character",
        subjectId: orderCharacterId,
        subjectName: (charDoc as unknown as { name?: string }).name ?? "(unknown)",
        amount: Math.round(refundInHome * 100) / 100,
        currencyCode: homeCurrency,
        counterpartyType: "system",
        counterpartyName: "Order book escrow",
        meta: {
          orderId: order._id.toString(),
          orderType: order.type,
          targetCorporationId: order.corporationId.toString(),
          escrowAmountAnchor: Math.round(refundAnchor * 100) / 100,
          imperial: collectionName === "imperialCharacters",
        },
      });
    } catch (error) {
      await restoreOrderToOpen(db, order._id);
      return { ok: false, error: (error as Error).message || "Failed to refund order owner" };
    }

    return { ok: true };
  }

  const claim = await db
    .collection<ShareOrder>("shareOrders")
    .updateOne(
      { _id: order._id, status: "open" },
      { $set: { status: "cancelled", updatedAt: now } }
    );
  if (claim.matchedCount === 0) return { ok: false, error: "Order is not open" };

  try {
    if (order.sharesDebitedAtCreation && order.placerCorporationId) {
      await creditSharesToCorp(
        db,
        order.corporationId,
        order.placerCorporationId,
        order.sharesRemaining,
        order.pricePerShare,
        { $set: { updatedAt: now } }
      );
    } else if (order.sharesDebitedAtCreation && order.characterId) {
      // Reserved-share restore for a character sell order (funds never sell here).
      await creditShares(
        db,
        order.corporationId,
        order.characterId,
        order.sharesRemaining,
        { $set: { updatedAt: now } },
        { pricePerShare: order.pricePerShare }
      );
    }
  } catch (error) {
    await restoreOrderToOpen(db, order._id);
    return { ok: false, error: (error as Error).message || "Failed to restore reserved shares" };
  }

  return { ok: true };
}
