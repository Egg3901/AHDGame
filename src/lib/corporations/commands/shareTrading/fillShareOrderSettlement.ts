/**
 * Settlement helpers for fillShareOrder — extracted verbatim (pure code
 * motion; no behavior change). Live production money-path code: the
 * buy-order settlement branch, party-name resolvers, and the post-fill
 * totalShares invariant correction.
 */
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, ShareListing, ShareOrder } from "@/lib/db/types";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  collectShareFillAuditRows,
  insertShareFillAuditRows,
  settleShareFillAttempt,
  type ShareFillAuditPlan,
} from "@/lib/corporations/commands/shareTrading/shareFillAudit";
import {
  executeShareFillMoneyFlow,
  personalBalanceField,
  SHARE_FILL_MONEY_SELLER_SHARES,
  type ShareFillMoneyPlan,
} from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import { computeAccountedShares } from "@/lib/corporations/shareInvariant";
import type { CurrencyCode } from "@/lib/constants/currencies";

export const resolveCharName = async (
  db: Db,
  id: ObjectId,
  isImperial: boolean
): Promise<string> => {
  const coll = isImperial ? "imperialCharacters" : "characters";
  const doc = await db
    .collection<{ _id: ObjectId; name?: string }>(coll)
    .findOne({ _id: id }, { projection: { name: 1 } });
  return doc?.name ?? (isImperial ? "Unknown imperial" : "Unknown character");
};

export const resolveCorpName = async (db: Db, id: ObjectId): Promise<string> => {
  const doc = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: id }, { projection: { name: 1 } });
  return doc?.name ?? "Unknown corporation";
};

/**
 * Evidence a filled fund sell order with the single fund-subject
 * `stock_trade_sell` ledger row. The fund's `cashAnchor` credit itself is a
 * keyed money leg now (issue #1672); this row is post-commit best effort,
 * emitted once per attempt under the caller's deterministic id so a retry
 * converges instead of double-booking. Shared by both seller-leg sites (the
 * corporation-buyer and character-buyer fills) so the committed-path-only
 * row is identical at both. Fund-subject rows never mirror, so this is the
 * only ledger row for the credit (the contra is the buyer's shares, an
 * asset account the shadow ledger does not carry).
 */
export async function emitSellerFundProceedsRow(args: {
  db: Db;
  fundId: ObjectId;
  fundName: string;
  fundAnchorCurrency: CurrencyCode;
  /** Fill proceeds in anchor (₳): `shares × order.pricePerShare` converted once. */
  total: number;
  buyer: {
    type: "corporation" | "character";
    id: ObjectId;
    name: string;
  };
  corporationId: ObjectId;
  orderId: ObjectId;
  shares: number;
  pricePerShare: number;
  currentTurn: number;
  now: Date;
  /** Deterministic insert id for the attempt (convergent on retry). */
  dedupeId: ObjectId;
}): Promise<void> {
  const {
    db,
    fundId,
    fundName,
    fundAnchorCurrency,
    total,
    buyer,
    corporationId,
    orderId,
    shares,
    pricePerShare,
    currentTurn,
    now,
    dedupeId,
  } = args;
  const outcome = await emitTx(
    db,
    {
      type: "stock_trade_sell",
      turn: currentTurn,
      createdAt: now,
      subjectType: "fund",
      subjectId: fundId,
      subjectName: fundName,
      amount: total,
      anchorAmount: total,
      currencyCode: fundAnchorCurrency,
      counterpartyType: buyer.type,
      counterpartyId: buyer.id,
      counterpartyName: buyer.name,
      meta: {
        corporationId: corporationId.toString(),
        orderId: orderId.toString(),
        shares,
        pricePerShare,
        source: "order_fill_sell_order",
      },
    },
    undefined,
    { _id: dedupeId }
  );
  if (outcome === "failed") {
    throw new Error("share-fill:fund-proceeds-row-failed");
  }
}

/**
 * Settle a fill against a BUY order — the filler is selling; the buyer's
 * money is already in escrow. Transfers shares from the filler to the buyer
 * (fund, corp, or character) and releases escrow to the filler, with full
 * compensating rollback on failure. Returns an error response, or null on
 * success.
 */
export async function settleBuyOrderFill(args: {
  db: Db;
  corporation: Corporation;
  order: ShareOrder;
  orderCharacterId: ShareOrder["characterId"];
  buyOrderBuyerCorp: Pick<Corporation, "_id" | "name"> | null;
  shares: number;
  total: number;
  totalInFillerHome: number;
  fillerId: ObjectId;
  fillerName: string;
  fillerCollectionName: "characters" | "imperialCharacters";
  fillerHomeCurrency: CurrencyCode;
  isImperialFiller: boolean;
  forexEnabled: boolean;
  currentTurn: number;
  now: Date;
  restoreClaimedOrder: () => Promise<void>;
  /**
   * Keyed-audit attempt claimed by the caller (issue #1672). The plan carries
   * the pinned buyer name and amounts; money below stays untouched, and the
   * audit rows are written convergently after the commit.
   */
  fillKey: string;
  plan: ShareFillAuditPlan;
}): Promise<NextResponse | null> {
  const {
    db,
    corporation,
    order,
    orderCharacterId,
    shares,
    total,
    totalInFillerHome,
    fillerId,
    fillerCollectionName,
    fillerHomeCurrency,
    isImperialFiller,
    forexEnabled,
    currentTurn,
    now,
    restoreClaimedOrder,
    fillKey,
    plan,
  } = args;

  const fillerAvgCost =
    corporation.shareholders?.find((sh) =>
      isImperialFiller ? sh.imperialCharacterId?.equals(fillerId) : sh.characterId?.equals(fillerId)
    )?.avgCostPerShare ?? order.pricePerShare;
  // All money moves through the keyed share-fill money flow (issue #1672):
  // filler share debit, buyer cap-table credit, fund holdings credit, and
  // escrow release run as compare-and-set steps under the attempt key with
  // keyed inverses, so a crash between any two converges on retry instead
  // of stranding shares or double-releasing escrow. The flow settles its
  // own receipt (compensating the prefix on a later-step failure); the
  // caller only restores the order claim and maps the legacy response.
  //
  // #992 audit, preserved: a buy-order fill moves NO fund cash. The fund's
  // cashAnchor was debited up front at placement, so the plan below carries
  // no proceeds leg — the filler is paid out of that already-moved escrow,
  // and the fund side of this fill is shares in. Proven by the
  // no-fund-cash-movement characterization test in
  // fillShareOrderSettlement.test.ts.
  const fillPriceAnchor = shares > 0 ? total / shares : 0;
  const moneyPlan: ShareFillMoneyPlan = {
    version: 1,
    fillKey,
    orderIdHex: order._id.toHexString(),
    corpIdHex: corporation._id.toHexString(),
    direction: "buy-fill",
    shares,
    turn: currentTurn,
    nowIso: now.toISOString(),
    fillerDebit: null,
    fillerCredit: {
      collection: fillerCollectionName,
      idHex: fillerId.toHexString(),
      field: personalBalanceField(fillerHomeCurrency, forexEnabled),
      amount: totalInFillerHome,
    },
    sellerDebit: {
      field: isImperialFiller ? "imperialCharacterId" : "characterId",
      idHex: fillerId.toHexString(),
      pricePerShare: fillerAvgCost,
    },
    buyerCredit: order.placerFundId
      ? {
          field: "fundId",
          idHex: order.placerFundId.toHexString(),
          pricePerShare: fillPriceAnchor,
        }
      : order.placerCorporationId
        ? {
            field: "corporationId",
            idHex: order.placerCorporationId.toHexString(),
            pricePerShare: order.pricePerShare,
          }
        : {
            field: "characterId",
            idHex: orderCharacterId!.toHexString(),
            pricePerShare: order.pricePerShare,
          },
    fundInventoryDebit: null,
    buyerHoldingsCredit: order.placerFundId
      ? {
          fundIdHex: order.placerFundId.toHexString(),
          pricePerShareAnchor: fillPriceAnchor,
        }
      : null,
    sellerProceeds: null,
  };
  try {
    await executeShareFillMoneyFlow(db, moneyPlan);
  } catch (err) {
    await restoreClaimedOrder();
    const code = err instanceof Error ? err.message.split(":")[0] : "";
    if (code === SHARE_FILL_MONEY_SELLER_SHARES) {
      await settleShareFillAttempt(db, fillKey, "failed", "share-fill:claim-restored");
      return NextResponse.json(
        { error: "You no longer have enough shares to fill this order" },
        { status: 409 }
      );
    }
    await settleShareFillAttempt(
      db,
      fillKey,
      "failed",
      err instanceof Error ? err.message : "share-fill:settlement-failed"
    );
    throw err;
  }
  // Money committed: the money flow flipped the audit receipt. The audit
  // rows below stay convergent deterministic-_id inserts, exactly as
  // before; an audit failure leaves the receipt in_progress for recovery
  // instead of rolling back moved money.
  {
    const auditOutcome = await insertShareFillAuditRows(
      db,
      fillKey,
      collectShareFillAuditRows(plan)
    );
    if (auditOutcome !== "failed") {
      await settleShareFillAttempt(db, fillKey, "completed");
    }
  }
  return null;
}

/**
 * Post-fill invariant: recompute totalShares from live positions and atomically
 * correct any drift. The update filter includes the expected totalShares value so
 * a concurrent correction from another fill doesn't stomp a valid update.
 */
export async function reconcileTotalSharesAfterFill(
  db: Db,
  corporationId: ObjectId
): Promise<void> {
  try {
    const [postFillCorp, postFillListings, postFillCorpSellOrders] = await Promise.all([
      db.collection<Corporation>("corporations").findOne({ _id: corporationId }),
      db
        .collection<ShareListing>("shareListings")
        .find({ corporationId, status: "open" })
        .toArray(),
      db
        .collection<ShareOrder>("shareOrders")
        .find({
          corporationId,
          type: "sell",
          status: "open",
          placerCorporationId: { $exists: true },
        })
        .toArray(),
    ]);
    if (postFillCorp) {
      const accounted = computeAccountedShares(
        postFillCorp,
        postFillListings,
        postFillCorpSellOrders
      );
      if (accounted !== (postFillCorp.totalShares ?? 0)) {
        await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: corporationId, totalShares: postFillCorp.totalShares },
            { $set: { totalShares: accounted, updatedAt: new Date() } }
          );
      }
    }
  } catch {
    // Non-fatal: fill succeeded; invariant correction is best-effort.
  }
}
