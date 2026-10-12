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
} from "@/lib/financialTxLog/atomicCashGuard";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  loadFxRatesRecord,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { autoConvertForPurchase, convertForExplicitPay } from "@/lib/currency/autoConvert";
import { quoteIndexFundSubscription } from "./unitAccounting";
import { witnessSubscription, type BankSubscription } from "./subscriptions";

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
      await witnessSubscription(tx, fund, order, "reserve", turn);
      return statusResponse(200, body);
    });
  } catch (error) {
    // A lost commit acknowledgement is reconciled by the durable command key.
    const committed = await replay(db);
    if (committed) return committed;
    throw error;
  }
}
