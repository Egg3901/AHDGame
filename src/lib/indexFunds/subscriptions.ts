/**
 * Bank fund subscriptions reserve investor cash now and buy units next turn.
 * The existing command receipt owns escrow until settlement or cancellation.
 * Every cash, unit and receipt write commits in one required transaction.
 */
import { subscriptionBatchNav } from "./rules/subscriptions";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { withSessionDb } from "@/lib/db/sessionDb";
import { errorResponse, statusResponse } from "@/lib/api/errors";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { bankFundAcceptsSubscriptions } from "./managerEligibility";
import { refundCharacterCash, refundCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";
import { creditFundPosition, insertFundTransaction } from "./fundQueries";
import { getQueuedRedemptionUnits } from "./fundValuation";
import { emitTx } from "@/lib/financialTxLog/emit";

export interface BankSubscription {
  _id: string;
  request: {
    fundId: string;
    kind: "subscribe";
    units: number;
    payCurrency?: string;
    corporationId?: string;
  };
  state: "completed";
  response: { status: number; body: Record<string, unknown> };
  subscription: {
    fundId: ObjectId;
    characterId: ObjectId;
    userId: string;
    corporationId?: ObjectId;
    amountAnchor: number;
    amountNative: number;
    currency: CurrencyCode;
    forex: boolean;
    dueTurn: number;
    status: "queued" | "settled" | "refunded";
    units?: number;
    settledTurn?: number;
  };
  createdAt: Date;
}

export async function witnessSubscription(
  db: Db,
  fund: IndexFund,
  order: BankSubscription,
  action: "reserve" | "refund" | "settle",
  turn: number
) {
  const s = order.subscription;
  const sign = action === "refund" ? 1 : -1;
  // Reservation cash belongs to the command, not to the bank or fund NAV.
  const holder = s.corporationId
    ? {
        subjectType: "corporation" as const,
        subjectId: s.corporationId,
        subjectName: "Corporate fund investor",
      }
    : { subjectType: "character" as const, subjectId: s.characterId, subjectName: "Fund investor" };
  const entries =
    action === "settle"
      ? [
          {
            subjectType: "system" as const,
            subjectName: "Fund subscription escrow",
            amount: -s.amountNative,
            anchorAmount: -s.amountAnchor,
          },
          {
            subjectType: "fund" as const,
            subjectId: fund._id,
            subjectName: fund.name,
            amount: s.amountAnchor,
            anchorAmount: s.amountAnchor,
          },
        ]
      : [
          {
            ...holder,
            amount: sign * s.amountNative,
            anchorAmount: sign * s.amountAnchor,
          },
          {
            subjectType: "system" as const,
            subjectName: "Fund subscription escrow",
            amount: -sign * s.amountNative,
            anchorAmount: -sign * s.amountAnchor,
          },
        ];
  for (const entry of entries) {
    const result = await emitTx(db, {
      ...entry,
      type: action === "refund" ? "index_fund_redeem" : "index_fund_subscribe",
      currencyCode: entry.subjectType === "fund" ? fund.anchorCurrencyCode : s.currency,
      counterpartyType: "system",
      counterpartyName: "Fund subscription escrow",
      turn,
      createdAt: new Date(),
      meta: {
        fundId: String(fund._id),
        operationId: order._id,
        subscriptionStep: action,
        ...(entry.subjectType === "system" ? { subscriptionEscrowId: order._id } : {}),
      },
    });
    if (result === "failed") throw new Error("Fund subscription witness failed");
  }
}

async function refundSubscription(tx: Db, fund: IndexFund, order: BankSubscription, turn: number) {
  const s = order.subscription;
  const refunded = s.corporationId
    ? await refundCorpLiquidCapital(tx, s.corporationId, s.amountNative)
    : await refundCharacterCash(tx, s.characterId, s.currency, s.amountNative, s.forex);
  if (!refunded) throw new Error("Subscription refund recipient is unavailable");
  await tx.collection<BankSubscription>("indexFundCommands").updateOne(
    { _id: order._id, "subscription.status": "queued" },
    {
      $set: {
        "subscription.status": "refunded",
        response: { status: 200, body: { success: true, refunded: true } },
      },
    }
  );
  await witnessSubscription(tx, fund, order, "refund", turn);
}

export async function cancelBankFundSubscription(
  db: Db,
  characterId: ObjectId,
  operationId: string
): Promise<Response> {
  return withSessionDb(db, async (tx) => {
    const order = await tx
      .collection<BankSubscription>("indexFundCommands")
      .findOne({ _id: `fund:${characterId}:${operationId}` });
    if (!order?.subscription) return errorResponse(404, "Investment order not found.");
    if (order.subscription.status === "settled")
      return errorResponse(409, "Your investment has settled. You can withdraw on the fund page.");
    if (order.subscription.status === "refunded")
      return statusResponse(200, { success: true, refunded: true });
    const fund = await tx
      .collection<IndexFund>("indexFunds")
      .findOne({ _id: order.subscription.fundId }, { projection: { floatSettlementPlan: 0 } });
    if (!fund) throw new Error("Subscription fund is unavailable");
    await refundSubscription(tx, fund, order, await getCurrentTurn(tx));
    return statusResponse(200, { success: true, refunded: true });
  });
}

/** One transaction per bounded fund batch gives all subscribers the same marked NAV. */
export async function settleBankFundSubscriptions(
  db: Db,
  turn: number,
  markedFundIds: ObjectId[]
): Promise<void> {
  const pending = await db
    .collection<BankSubscription>("indexFundCommands")
    .find(
      {
        "subscription.status": "queued",
        "subscription.dueTurn": { $lte: turn },
      },
      { projection: { "subscription.fundId": 1 } }
    )
    .toArray();
  const ids = [...new Set(pending.map((o) => String(o.subscription.fundId)))];
  for (const id of ids) {
    let moreDue = true;
    while (moreDue) {
      moreDue = await withSessionDb(db, async (tx) => {
        const fund = await tx
          .collection<IndexFund>("indexFunds")
          .findOne({ _id: new ObjectId(id) }, { projection: { floatSettlementPlan: 0 } });
        if (!fund) throw new Error("Subscription fund is unavailable");
        const accepting = await bankFundAcceptsSubscriptions(tx, fund);
        if (accepting && !markedFundIds.some((f) => String(f) === id)) return false;
        const orders = await tx
          .collection<BankSubscription>("indexFundCommands")
          .find({
            "subscription.fundId": fund._id,
            "subscription.status": "queued",
            "subscription.dueTurn": { $lte: turn },
          })
          .sort({ createdAt: 1, _id: 1 })
          .limit(100)
          .toArray();
        if (!orders.length) return false;
        if (!accepting) {
          for (const order of orders) await refundSubscription(tx, fund, order, turn);
          return orders.length === 100;
        }
        const queuedUnits = await getQueuedRedemptionUnits(tx, fund._id);
        const nav = subscriptionBatchNav({
          cashAnchor: fund.cashAnchor,
          holdingsValueAnchor: fund.holdings.reduce(
            (sum, h) => sum + (h.lastValueAnchor ?? h.shares * (h.avgCostPerShareAnchor ?? 0)),
            0
          ),
          unitSupply: fund.unitSupply,
          queuedUnits,
        });
        let cash = 0,
          units = 0;
        for (const order of orders) {
          const s = order.subscription;
          const issued = s.amountAnchor / nav;
          await creditFundPosition(
            tx,
            fund._id,
            s.corporationId ? "corporation" : "character",
            s.corporationId ? { corporationId: s.corporationId } : { characterId: s.characterId },
            issued,
            nav
          );
          await insertFundTransaction(tx, {
            fundId: fund._id,
            kind: "subscription",
            holderKind: s.corporationId ? "corporation" : "character",
            ...(s.corporationId
              ? { corporationId: s.corporationId }
              : { characterId: s.characterId }),
            units: issued,
            navAnchor: nav,
            amountAnchor: s.amountAnchor,
            turn,
            note: "Next-turn investment",
            createdAt: new Date(),
          });
          await witnessSubscription(tx, fund, order, "settle", turn);
          cash += s.amountAnchor;
          units += issued;
        }
        const receipts = await tx.collection<BankSubscription>("indexFundCommands").bulkWrite(
          orders.map((order) => ({
            updateOne: {
              filter: { _id: order._id, "subscription.status": "queued" },
              update: {
                $set: {
                  "subscription.status": "settled",
                  "subscription.units": order.subscription.amountAnchor / nav,
                  "subscription.settledTurn": turn,
                  response: {
                    status: 200,
                    body: {
                      success: true,
                      units: order.subscription.amountAnchor / nav,
                      costAnchor: order.subscription.amountAnchor,
                      nav,
                    },
                  },
                },
              },
            },
          }))
        );
        if (receipts.matchedCount !== orders.length)
          throw new Error("Subscription receipts changed");
        const credited = await tx.collection("indexFunds").updateOne(
          {
            _id: fund._id,
            status: "active",
            cashAnchor: fund.cashAnchor,
            unitSupply: fund.unitSupply,
            holdings: fund.holdings,
          },
          {
            $inc: { cashAnchor: cash, unitSupply: units },
            $set: { quotedNav: nav, updatedAt: new Date() },
          }
        );
        if (!credited.matchedCount) throw new Error("Subscription valuation changed");
        return orders.length === 100;
      });
    }
  }
}
