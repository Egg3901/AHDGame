// POST: fill (or partially fill) another player's open limit order
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403 (own order / forex disabled), 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, getPersonalBalance } from "@/lib/currency/characterFunds";
import {
  calculateSpreadFee,
  distributeSpreadFee,
  reverseSpreadFee,
} from "@/lib/currency/spreadFees";
import { getCountryForCurrency } from "@/lib/currency/marketMaker";
import { LIMIT_ORDER_SPREAD } from "@/lib/constants/currencies";
import {
  nonConvertibleCurrencyMessage,
  nonConvertibleTradeCurrency,
} from "@/lib/constants/commandEconomy";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { CurrencyOrder, GameConfig, GameState, TradeHistoryEntry } from "@/lib/db/types";
import { recordAudit } from "@/lib/audit/recordAudit";

interface RouteParams {
  params: Promise<{ orderId: string }>;
}

const fillSchema = z.object({
  /** Amount of the order's fromCurrency to fill. If omitted, fills the full remaining. */
  amount: z.number().positive().optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) throw forbidden("Currency exchange is not yet enabled");

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateCheck = checkRateLimit(auth.user.userId, 30, 60_000);
    if (!rateCheck.ok) return rateLimitResponse(rateCheck.retryAfter);

    const { orderId } = await params;
    if (!ObjectId.isValid(orderId)) throw badRequest("Invalid order ID");

    const parsed = await parseJsonBody(request, fillSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const {
      applyFillLegs,
      buildFillIntent,
      claimFillWithIntent,
      recoverFillClaim,
      restoreFillClaim,
      reverseLandedFillLegs,
    } = await import("@/lib/forex/fillRecovery");
    let order = await db
      .collection<CurrencyOrder>("currencyOrders")
      .findOne({ _id: new ObjectId(orderId) });

    if (!order) throw notFound("Order not found");
    if (order.type !== "limit") throw badRequest("Only limit orders can be peer-filled");
    if (order.status === "processing" && order.processingFill) {
      // A previous attempt crashed after claiming. A stale claim is finished
      // or undone first; a live one is never stolen.
      const recovery = await recoverFillClaim(db, order._id);
      if (recovery.outcome === "completed" || recovery.outcome === "rolled-back") {
        const reread = await db
          .collection<CurrencyOrder>("currencyOrders")
          .findOne({ _id: order._id });
        if (!reread) throw notFound("Order not found");
        order = reread;
      }
    }
    if (order.status !== "open" && order.status !== "partial") {
      throw badRequest("Order is not available for filling");
    }
    if (order.characterId.toString() === auth.user.character._id.toString()) {
      throw forbidden("Cannot fill your own order");
    }

    const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const gameConfig = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
    const blocked = nonConvertibleTradeCurrency(
      [order.fromCurrency, order.toCurrency],
      gs?.currentYear,
      gameConfig?.commandEconomyEnabled === true
    );
    if (blocked) {
      throw badRequest(nonConvertibleCurrencyMessage(blocked));
    }

    const remaining = order.amount - order.filledAmount;
    const fillAmount = parsed.data.amount ? Math.min(parsed.data.amount, remaining) : remaining;

    if (fillAmount <= 0) throw badRequest("Nothing left to fill on this order");

    // The filler takes the opposite side: they provide toCurrency and receive fromCurrency.
    // Use the order's limitRate as the trade rate.
    // Total spread: 0.175%, split evenly (0.0875% each side).
    const halfSpreadRate = LIMIT_ORDER_SPREAD / 2;

    // Filler needs to provide toCurrency amount: fillAmount * limitRate
    const toCurrencyAmount = fillAmount * order.limitRate!;

    // Each party pays spread in their own currency denomination
    const posterSpreadFromCurrency = calculateSpreadFee(fillAmount, halfSpreadRate);
    const fillerSpreadToCurrency = calculateSpreadFee(toCurrencyAmount, halfSpreadRate);

    const fillerBalance = getPersonalBalance(auth.user.character, order.toCurrency, true);
    const fillerTotalCost = toCurrencyAmount + fillerSpreadToCurrency;
    if (fillerBalance < fillerTotalCost) {
      throw badRequest(
        `Insufficient ${order.toCurrency}. Need ${Math.ceil(fillerTotalCost).toLocaleString()}, have ${Math.floor(fillerBalance).toLocaleString()}.`
      );
    }

    const currentTurn = gs?.currentTurn ?? 0;
    const now = new Date();

    const newFilledAmount = order.filledAmount + fillAmount;
    const newStatus = newFilledAmount >= order.amount ? "filled" : "partial";

    // Balance updates:
    // Filler: deduct toCurrency (amount + spread), credit fromCurrency net of the
    // poster's half-spread. That half-spread was escrowed by the poster at order
    // creation (escrow = order.amount fromCurrency) and is now routed to the CB via
    // distributeSpreadFee below. Crediting the filler the FULL fillAmount while also
    // handing posterSpreadFromCurrency to the CB minted fromCurrency on every fill
    // (nothing was ever debited for it). Netting it out of the filler credit makes
    // the escrow actually fund the spread: (fillAmount - posterSpread) to filler +
    // posterSpread to CB = fillAmount out of escrow. Conserved.
    // Poster: credit toCurrency (amount), poster spread stays escrowed and is distributed
    const fillerFromCurrencyCredit = fillAmount - posterSpreadFromCurrency;
    const fillerSettlementInc = {
      ...buildPersonalBalanceInc(-fillerTotalCost, order.toCurrency, true),
      ...buildPersonalBalanceInc(fillerFromCurrencyCredit, order.fromCurrency, true),
    };
    const posterCreditInc = buildPersonalBalanceInc(toCurrencyAmount, order.toCurrency, true);

    const fromCountryId = getCountryForCurrency(order.fromCurrency);
    const toCountryId = getCountryForCurrency(order.toCurrency);
    const claimFilter = {
      _id: order._id,
      status: { $in: ["open", "partial"] as const },
      filledAmount: order.filledAmount,
    };
    const tradeHistoryEntry = {
      buyerCharacterId: order.characterId,
      sellerCharacterId: auth.user.character._id,
      fromCurrency: order.fromCurrency,
      toCurrency: order.toCurrency,
      amount: fillAmount,
      rate: order.limitRate!,
      spread: posterSpreadFromCurrency,
      turn: currentTurn,
      createdAt: now,
      source: "limit_order",
    } as TradeHistoryEntry;

    // The spread fee is part of the fill, not a post-fill side effect. It runs
    // INSIDE the transition, after both balances settle and BEFORE the order's
    // filledAmount flips — so a fee failure aborts/rolls back the fill instead
    // of leaving both parties credited with the fee uncollected. It is invoked
    // exactly once per closure and never retried (the transaction helper does
    // not re-run a started transaction sequentially).
    const spreadFeeLegs = [
      fromCountryId
        ? ([posterSpreadFromCurrency, fromCountryId, order.fromCurrency, toCountryId] as const)
        : null,
      toCountryId
        ? ([fillerSpreadToCurrency, toCountryId, order.toCurrency, fromCountryId] as const)
        : null,
    ].filter((leg): leg is NonNullable<typeof leg> => leg !== null);
    // Durable intent for the sequential path: written atomically with the
    // claim so a crash anywhere after it is recoverable. The transactional
    // path below does not use it (atomic commit needs no replay record).
    const fillIntent = buildFillIntent({
      orderId: order._id,
      fillerId: auth.user.character._id,
      posterId: order.characterId,
      statusBefore: order.status,
      filledAmountBefore: order.filledAmount,
      fillAmount,
      newFilledAmount,
      newStatus,
      fromCurrency: order.fromCurrency,
      toCurrency: order.toCurrency,
      toCurrencyAmount,
      posterSpread: posterSpreadFromCurrency,
      fillerSpread: fillerSpreadToCurrency,
      fillerTotalCost,
      spreadTuples: spreadFeeLegs.map(([fee, source, currency, destination]) => ({
        fee,
        source,
        currency,
        dest: destination ?? undefined,
      })),
      rate: order.limitRate!,
      turn: currentTurn,
      now,
    });
    const distributeSpreadFees = async (session?: import("mongodb").ClientSession) => {
      let applied = 0;
      try {
        for (const [fee, source, currency, destination] of spreadFeeLegs) {
          await distributeSpreadFee(db, fee, source, currency, destination ?? undefined, {
            session,
          });
          applied++;
        }
      } catch (error) {
        if (session || applied === 0) throw error;
        const compensationErrors = await reverseAppliedSpreadFees(applied);
        if (compensationErrors.length > 0) {
          throw new AggregateError(
            [error, ...compensationErrors],
            "Spread-fee distribution failed and completed legs could not all be reversed"
          );
        }
        throw error;
      }
      return applied;
    };
    const reverseAppliedSpreadFees = async (count: number) => {
      const errors: unknown[] = [];
      for (const [fee, source, currency, destination] of spreadFeeLegs.slice(0, count).reverse()) {
        try {
          await reverseSpreadFee(db, fee, source, currency, destination ?? undefined);
        } catch (error) {
          errors.push(error);
        }
      }
      return errors;
    };
    await runWithOptionalTransaction(
      async (session) => {
        const claimedOrder = await db
          .collection<CurrencyOrder>("currencyOrders")
          .findOneAndUpdate(
            claimFilter,
            { $set: { status: "processing", updatedAt: now } },
            { returnDocument: "before", session }
          );
        if (!claimedOrder) {
          throw badRequest("Order was already filled by another trader");
        }

        const fillerResult = await db.collection("characters").updateOne(
          {
            _id: auth.user.character._id,
            [`currencyBalances.personal.${order.toCurrency}`]: { $gte: fillerTotalCost },
          },
          { $inc: fillerSettlementInc },
          { session }
        );
        if (fillerResult.modifiedCount === 0) {
          throw badRequest(`Insufficient ${order.toCurrency} balance`);
        }

        const posterResult = await db
          .collection("characters")
          .updateOne({ _id: order.characterId }, { $inc: posterCreditInc }, { session });
        if (posterResult.matchedCount === 0) {
          throw notFound("Order owner not found");
        }

        await distributeSpreadFees(session);

        const fillResult = await db.collection<CurrencyOrder>("currencyOrders").updateOne(
          { _id: order._id, status: "processing" },
          {
            $set: { status: newStatus, updatedAt: now },
            $inc: { filledAmount: fillAmount, spreadCharged: posterSpreadFromCurrency },
          },
          { session }
        );
        if (fillResult.matchedCount === 0) {
          throw badRequest("Order was already filled by another trader");
        }

        await db.collection<TradeHistoryEntry>("tradeHistory").insertOne(tradeHistoryEntry, {
          session,
        });
      },
      async () => {
        // Sequential path (standalone Mongo): the claim carries the intent,
        // every leg is stamped and idempotent, and a crash anywhere after the
        // claim is finished or undone by recovery instead of compensated here
        // (compensation only handles caught errors, never crashes).
        const claimedOrder = await claimFillWithIntent(db, claimFilter, fillIntent, now);
        if (!claimedOrder) {
          throw badRequest("Order was already filled by another trader");
        }

        try {
          const applied = await applyFillLegs(db, fillIntent, now, distributeSpreadFee);
          if (!applied.ok) {
            if (applied.leg === "filler") {
              throw badRequest(`Insufficient ${order.toCurrency} balance`);
            }
            if (applied.leg === "poster") {
              throw notFound("Order owner not found");
            }
            throw new Error(applied.message);
          }
          if (!applied.flipWon) {
            // A concurrent recovery flipped this same intent first. Re-read
            // for the true state rather than reporting the race as a failure.
            const current = await db
              .collection<CurrencyOrder>("currencyOrders")
              .findOne({ _id: order._id });
            if (!current || current.processingFillKey === fillIntent.key) {
              throw badRequest("Order was already filled by another trader");
            }
          }
        } catch (error) {
          // The claim is fresh for this entire request. Recovery refuses to
          // steal it until the stale threshold, so synchronous compensation
          // still owns the intent and can safely reverse its landed legs.
          try {
            await reverseLandedFillLegs(db, fillIntent, now);
            await restoreFillClaim(db, fillIntent, now);
          } catch (compensationError) {
            throw new AggregateError(
              [error, compensationError],
              "Forex fill failed and one or more compensation steps were incomplete"
            );
          }
          throw error;
        }
      }
    );

    recordAudit({
      source: "api",
      action: "forex.fill",
      category: "market",
      subject: {
        type: "currencyOrder",
        id: order._id,
        name: `${order.fromCurrency}->${order.toCurrency}`,
      },
      counterparty: { type: "character", id: order.characterId, name: undefined },
      amount: fillAmount,
      currencyCode: order.fromCurrency,
      delta: [
        { field: "status", before: order.status, after: newStatus },
        { field: "filledAmount", before: order.filledAmount, after: newFilledAmount },
        { field: "fillAmount", before: null, after: fillAmount },
        { field: "rate", before: null, after: order.limitRate },
      ],
      outcome: "ok",
    });

    return NextResponse.json({
      success: true,
      filledAmount: fillAmount,
      rate: order.limitRate,
      posterSpread: posterSpreadFromCurrency,
      fillerSpread: fillerSpreadToCurrency,
      orderStatus: newStatus,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
