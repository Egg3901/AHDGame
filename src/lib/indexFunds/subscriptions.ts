/**
 * Bank fund subscriptions reserve investor cash now and buy units next turn.
 * The existing command receipt owns escrow until settlement or cancellation.
 * Every cash, unit and receipt write commits in one required transaction.
 */
import { subscriptionBatchNav } from "./rules/subscriptions";
import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation, IndexFund } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { withSessionDb } from "@/lib/db/sessionDb";
import { errorResponse, statusResponse, badRequest } from "@/lib/api/errors";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { bankFundAcceptsSubscriptions } from "./managerEligibility";
import {
  atomicallyDebitCharacterCash,
  atomicallyDebitCorpLiquidCapital,
  refundCharacterCash,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { autoConvertForPurchase, convertForExplicitPay } from "@/lib/currency/autoConvert";
import { creditFundPosition, insertFundTransaction } from "./fundQueries";
import { quoteIndexFundSubscription } from "./unitAccounting";
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

async function witness(
  db: Db,
  fund: IndexFund,
  order: BankSubscription,
  action: "reserve" | "refund" | "settle",
  turn: number
) {
  const s = order.subscription;
  const sign = action === "refund" ? 1 : -1;
  // Reservation cash belongs to the command, not to the bank or fund NAV.
  const holderType = s.corporationId ? "corporation" : "character";
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
            subjectType: holderType,
            subjectId: s.corporationId ?? s.characterId,
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
      subjectType: entry.subjectType as "character" | "corporation" | "system" | "fund",
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

export async function queueBankFundSubscription(
  db: Db,
  input: {
    fund: IndexFund;
    characterId: ObjectId;
    userId: string;
    operationId: string;
    units: number;
    payCurrency?: CurrencyCode;
    corporationId?: string;
  }
): Promise<Response> {
  const key = `fund:${input.characterId}:${input.operationId}`;
  const request: BankSubscription["request"] = {
    fundId: String(input.fund._id),
    kind: "subscribe",
    units: input.units,
    ...(input.payCurrency ? { payCurrency: input.payCurrency } : {}),
    ...(input.corporationId ? { corporationId: input.corporationId } : {}),
  };
  const replay = async (tx: Db): Promise<Response | null> => {
    const prior = await tx.collection<BankSubscription>("indexFundCommands").findOne({ _id: key });
    if (!prior) return null;
    if (JSON.stringify(prior.request) !== JSON.stringify(request))
      return errorResponse(409, "This order ID belongs to a different fund order.");
    if (!prior.subscription) return errorResponse(409, "This order is still being checked.");
    return statusResponse(prior.response.status, prior.response.body);
  };
  const previous = await replay(db);
  if (previous) return previous;
  const rejection = await rejectDuringTurn(db);
  if (rejection) return rejection;
  try {
    return await withSessionDb(db, async (tx) => {
      const prior = await replay(tx);
      if (prior) return prior;
      const fund = await tx
        .collection<IndexFund>("indexFunds")
        .findOne({ _id: input.fund._id }, { projection: { floatSettlementPlan: 0 } });
      if (
        !fund ||
        fund.mandate?.mode !== "picked_stocks" ||
        !(await bankFundAcceptsSubscriptions(tx, fund))
      )
        return errorResponse(403, "This fund is not accepting investments.");
      const character = await tx
        .collection<Character>("characters")
        .findOne({ _id: input.characterId });
      if (!character || String(character.userId) !== input.userId)
        return errorResponse(403, "An active character is required.");
      const corporationId = input.corporationId ? new ObjectId(input.corporationId) : undefined;
      const corporation = corporationId
        ? await tx.collection<Corporation>("corporations").findOne({ _id: corporationId })
        : null;
      if (corporationId && (!corporation || String(corporation.userId) !== input.userId))
        return errorResponse(403, "Only the CEO can invest for a corporation.");
      const forex = await isForexEnabled();
      const currency = corporation
        ? (resolveCorpLiquidCurrencyCode(corporation) ?? fund.anchorCurrencyCode)
        : fund.anchorCurrencyCode;
      const rates = forex ? await loadFxRatesRecord(tx) : {};
      const rate = forex ? rates[currency] : 1;
      if (!rate || !Number.isFinite(rate) || rate <= 0)
        return errorResponse(503, "Exchange rate unavailable, try again shortly.");
      const amountAnchor = quoteIndexFundSubscription(fund.quotedNav, input.units).costAnchor;
      const amountNative = amountAnchor * rate;
      const turn = await getCurrentTurn(tx);
      if (!corporation && forex) {
        const conversion =
          input.payCurrency && input.payCurrency !== currency
            ? await convertForExplicitPay(tx, {
                character,
                payCurrency: input.payCurrency,
                requiredCurrency: currency,
                requiredAmount: amountNative,
                turn,
                forexEnabled: forex,
              })
            : await autoConvertForPurchase(tx, {
                character,
                requiredCurrency: currency,
                requiredAmount: amountNative,
                turn,
                forexEnabled: forex,
              });
        if (!conversion.success)
          throw badRequest(conversion.error ?? "Cash conversion could not complete.");
      }
      const debit = corporationId
        ? await atomicallyDebitCorpLiquidCapital(tx, corporationId, amountNative)
        : await atomicallyDebitCharacterCash(tx, input.characterId, currency, amountNative, forex);
      if (!debit.ok) throw badRequest(debit.error);
      // Touch the fund so enqueue conflicts with concurrent closure and redemption.
      const reserved = await tx
        .collection("indexFunds")
        .updateOne({ _id: fund._id, status: "active" }, { $set: { updatedAt: new Date() } });
      if (!reserved.matchedCount) throw badRequest("The fund is no longer accepting investments.");
      const body = {
        success: true,
        queued: true,
        operationId: input.operationId,
        costAnchor: amountAnchor,
        dueTurn: turn + 1,
        message: "Your cash is reserved. The final unit count is set next turn.",
      };
      const order: BankSubscription = {
        _id: key,
        request,
        state: "completed",
        response: { status: 200, body },
        createdAt: new Date(),
        subscription: {
          fundId: fund._id,
          characterId: input.characterId,
          userId: input.userId,
          ...(corporationId ? { corporationId } : {}),
          amountAnchor,
          amountNative,
          currency,
          forex,
          dueTurn: turn + 1,
          status: "queued",
        },
      };
      await tx.collection<BankSubscription>("indexFundCommands").insertOne(order);
      await witness(tx, fund, order, "reserve", turn);
      return statusResponse(200, body);
    });
  } catch (error) {
    // A lost commit acknowledgement is reconciled by the durable command key.
    const committed = await replay(db);
    if (committed) return committed;
    throw error;
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
  await witness(tx, fund, order, "refund", turn);
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
          await tx.collection<BankSubscription>("indexFundCommands").updateOne(
            { _id: order._id, "subscription.status": "queued" },
            {
              $set: {
                "subscription.status": "settled",
                "subscription.units": issued,
                "subscription.settledTurn": turn,
                response: {
                  status: 200,
                  body: { success: true, units: issued, costAnchor: s.amountAnchor, nav },
                },
              },
            }
          );
          await witness(tx, fund, order, "settle", turn);
          cash += s.amountAnchor;
          units += issued;
        }
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
