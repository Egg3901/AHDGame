/**
 * Corporations buy fund units with their own liquid capital and redeem at NAV.
 * Corporate cash uses the corporation's currency; fund cash and positions use
 * anchor values. Orders retain receipts and audit witnesses for safe retries.
 */
import { ObjectId, type Db } from "mongodb";
import type { Corporation, IndexFund } from "@/lib/db/types";
import { badRequest, errorResponse, handleRouteError } from "@/lib/api/errors";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import {
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import {
  anchorToCorpLiquidCapital,
  estimateCorpWalletSpend,
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { loadEuroMonetaryUnion } from "@/lib/currency/euro/service";
import { loadForexSpreadStrengths } from "@/lib/currency/euro/quotes";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getPosition,
  creditFundPosition,
  debitFundPosition,
  insertFundTransaction,
} from "./fundQueries";
import {
  claimFundCommand,
  completeFundCommand,
  pendingFundCommandResponse,
  recordFundCommandQuote,
} from "./playerCommand";
import { resumeFundCommandAudit } from "./playerCommandAudit";
import { isIndexFundsFullMode, INDEX_FUNDS_PARTIAL_MESSAGE } from "./featureFlag";
import { quoteIndexFundSubscription } from "./unitAccounting";
import { getQueuedRedemptionLiabilityAnchor } from "./fundValuation";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { claimFundRedemptionLock } from "./redemptionLock";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";

export async function tradeCorporationFund(
  db: Db,
  userId: string,
  characterId: ObjectId,
  fund: IndexFund,
  order: { corporationId: string; operationId: string; units: number },
  kind: "subscribe" | "redeem"
): Promise<Response> {
  const corporationId = new ObjectId(order.corporationId);
  const corporation = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corporationId });
  if (!corporation) return errorResponse(404, "Corporation not found");
  if (corporation.userId?.toString() !== userId)
    return errorResponse(403, "Only the CEO can invest for a corporation");
  const command = await claimFundCommand(db, characterId, order.operationId, {
    fundId: fund._id.toHexString(),
    kind,
    units: order.units,
    corporationId: order.corporationId,
  });
  if (command.response) return command.response;
  const finish = async (response: Response) => {
    await completeFundCommand(db, command.key, await response.clone().json(), response.status);
    await resumeFundCommandAudit(db, command.key);
    return response;
  };
  if (!(await isIndexFundsFullMode()))
    return finish(errorResponse(403, INDEX_FUNDS_PARTIAL_MESSAGE));
  const turnRejection = await rejectDuringTurn(db);
  if (turnRejection) return finish(turnRejection);
  if (kind === "subscribe" && fund.status !== "active")
    return finish(errorResponse(400, "Fund is not accepting subscriptions"));
  if (kind === "redeem" && fund.status === "delisted")
    return finish(errorResponse(400, "Fund is delisted"));
  const amountAnchor = quoteIndexFundSubscription(fund.quotedNav, order.units).costAnchor;
  const currency = resolveCorpLiquidCurrencyCode(corporation);
  const forex = await isForexEnabled();
  const rates = forex ? await loadFxRatesRecord(db) : {};
  const rate = forex && currency ? rates[currency] : 1;
  if (!rate || rate <= 0)
    return finish(errorResponse(503, "Exchange rate unavailable, try again shortly"));
  const fundRate = forex ? rates[fund.anchorCurrencyCode] : 1;
  if (!fundRate || fundRate <= 0)
    return finish(errorResponse(503, "Exchange rate unavailable, try again shortly"));
  const spend =
    kind === "subscribe" && forex && currency
      ? estimateCorpWalletSpend({
          union: await loadEuroMonetaryUnion(db),
          spreadStrengths: await loadForexSpreadStrengths(db),
          requiredAmount: amountAnchor * fundRate,
          availableBalance: corporation.liquidCapital,
          fromCurrency: currency ?? null,
          toCurrency: fund.anchorCurrencyCode,
          rates,
        })
      : null;
  if (kind === "subscribe" && forex && currency && !spend)
    return finish(errorResponse(503, "Exchange rate unavailable, try again shortly"));
  if (spend && !spend.canAfford) return finish(errorResponse(400, "Insufficient corporate funds"));
  const amountNative =
    kind === "subscribe" && spend
      ? spend.spendAmount
      : anchorToCorpLiquidCapital(amountAnchor, corporation, rate);
  const turn = await getCurrentTurn(db);
  await recordFundCommandQuote(db, command.key, {
    turn,
    navAnchor: fund.quotedNav,
    amountAnchor,
    amountNative,
    corporationId: order.corporationId,
  });
  try {
    let response: Record<string, unknown> = {};
    await runTransactionWithSessionRetry(
      async () => db.client,
      async (session) => {
        const options = session ? { session } : undefined;
        const releaseLock = !session ? await claimFundRedemptionLock(db, fund._id) : null;
        if (!session && !releaseLock)
          throw badRequest("Another fund order is in progress; retry shortly");
        const undo: Array<() => Promise<unknown>> = [];
        let completionStarted = false;
        try {
          const currentCorp = await db
            .collection<Corporation>("corporations")
            .findOne({ _id: corporationId, userId: new ObjectId(userId) }, options);
          if (!currentCorp)
            throw badRequest("Corporation ownership changed; reload before trading");
          let balanceAfter = 0;
          if (kind === "subscribe") {
            const priorPosition = await getPosition(
              db,
              fund._id,
              "corporation",
              { corporationId },
              options
            );
            const debit = await atomicallyDebitCorpLiquidCapital(
              db,
              corporationId,
              amountNative,
              options
            );
            if (!debit.ok) throw badRequest(debit.error);
            balanceAfter = debit.newBalance;
            undo.push(() => refundCorpLiquidCapital(db, corporationId, amountNative));
            await creditFundPosition(
              db,
              fund._id,
              "corporation",
              { corporationId },
              order.units,
              fund.quotedNav,
              options
            );
            undo.push(async () => {
              const restored = await debitFundPosition(
                db,
                fund._id,
                "corporation",
                { corporationId },
                order.units
              );
              if (!restored.ok) throw new Error("Corporate fund position compensation failed");
              if (priorPosition)
                await db
                  .collection("indexFundPositions")
                  .updateOne(
                    { _id: priorPosition._id },
                    priorPosition.avgNavAnchor == null
                      ? { $unset: { avgNavAnchor: "" } }
                      : { $set: { avgNavAnchor: priorPosition.avgNavAnchor } }
                  );
            });
            const credited = await db.collection("indexFunds").updateOne(
              { _id: fund._id, status: "active", quotedNav: fund.quotedNav },
              {
                $inc: { unitSupply: order.units, cashAnchor: amountAnchor },
                $set: { updatedAt: new Date() },
              },
              options
            );
            if (!credited.matchedCount)
              throw badRequest("Fund quote changed; reload before trading");
            undo.push(() =>
              db
                .collection("indexFunds")
                .updateOne(
                  { _id: fund._id },
                  { $inc: { unitSupply: -order.units, cashAnchor: -amountAnchor } }
                )
            );
            response = {
              success: true,
              units: order.units,
              costAnchor: amountAnchor,
              nav: fund.quotedNav,
              balanceAfter,
            };
          } else {
            const prior = await getPosition(
              db,
              fund._id,
              "corporation",
              { corporationId },
              options
            );
            if (!prior || prior.units < order.units)
              throw badRequest("Insufficient corporation fund units");
            const liability = await getQueuedRedemptionLiabilityAnchor(db, fund._id);
            const debitedFund = await db.collection("indexFunds").updateOne(
              {
                _id: fund._id,
                status: { $ne: "delisted" },
                quotedNav: fund.quotedNav,
                unitSupply: { $gte: order.units },
                cashAnchor: { $gte: amountAnchor + liability },
              },
              {
                $inc: { unitSupply: -order.units, cashAnchor: -amountAnchor },
                $set: { updatedAt: new Date() },
              },
              options
            );
            if (!debitedFund.matchedCount)
              throw badRequest(
                "Fund cash is unavailable or the quote changed. Units remain invested; retry after the fund cycle."
              );
            undo.push(() =>
              db
                .collection("indexFunds")
                .updateOne(
                  { _id: fund._id },
                  { $inc: { unitSupply: order.units, cashAnchor: amountAnchor } }
                )
            );
            const debit = await debitFundPosition(
              db,
              fund._id,
              "corporation",
              { corporationId },
              order.units,
              options
            );
            if (!debit.ok) throw badRequest("Insufficient corporation fund units");
            undo.push(() =>
              creditFundPosition(
                db,
                fund._id,
                "corporation",
                { corporationId },
                order.units,
                prior.avgNavAnchor ?? fund.quotedNav
              )
            );
            const paid = await db
              .collection<Corporation>("corporations")
              .findOneAndUpdate(
                { _id: corporationId },
                { $inc: { liquidCapital: amountNative } },
                { ...options, returnDocument: "after", projection: { liquidCapital: 1 } }
              );
            if (!paid) throw badRequest("Corporation no longer exists");
            balanceAfter = paid.liquidCapital;
            undo.push(() =>
              db
                .collection("corporations")
                .updateOne({ _id: corporationId }, { $inc: { liquidCapital: -amountNative } })
            );
            response = {
              success: true,
              redeemedUnits: order.units,
              paidAmountAnchor: amountAnchor,
              queuedUnits: 0,
              status: "paid",
              balanceAfter,
            };
          }
          const transactionId = await insertFundTransaction(
            db,
            {
              fundId: fund._id,
              holderKind: "corporation",
              corporationId,
              kind: kind === "subscribe" ? "subscription" : "redemption",
              units: order.units,
              navAnchor: fund.quotedNav,
              amountAnchor,
              turn,
              createdAt: new Date(),
            },
            options
          );
          undo.push(() => db.collection("indexFundTransactions").deleteOne({ _id: transactionId }));
          completionStarted = true;
          await completeFundCommand(db, command.key, response, 200, session, {
            fundId: fund._id,
            fundName: fund.name,
            fundSlug: fund.slug,
            fundTicker: fund.tickerSymbol,
            currencyCode: currency ?? "USD",
            fundCurrency: fund.anchorCurrencyCode,
            holderKind: "corporation",
            holderId: corporationId,
            holderName: corporation.name,
            turn,
            entries: [
              {
                transactionId,
                amountNative: kind === "subscribe" ? -amountNative : amountNative,
                anchorAmount: amountNative / rate,
                balanceAfter,
              },
            ],
          });
        } catch (error) {
          if (!session && !completionStarted) {
            for (const revert of undo.reverse()) await revert();
          }
          throw error;
        } finally {
          await releaseLock?.();
        }
      }
    );
    await resumeFundCommandAudit(db, command.key);
    return Response.json(response);
  } catch (error) {
    // Preserve unknown outcomes so a retry cannot execute the order again.
    if (error instanceof Error && "status" in error && error.status === 400)
      return finish(errorResponse(400, error.message));
    handleRouteError(error);
    return pendingFundCommandResponse(order.operationId);
  }
}
