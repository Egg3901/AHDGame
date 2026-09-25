// POST: accept or decline a direct trade request
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403 (not target / forex disabled), 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceInc, getPersonalBalance } from "@/lib/currency/characterFunds";
import {
  calculateSpreadFee,
  distributeSpreadFee,
  reverseSpreadFee,
} from "@/lib/currency/spreadFees";
import { getCountryForCurrency } from "@/lib/currency/marketMaker";
import { DIRECT_TRADE_SPREAD } from "@/lib/constants/currencies";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { SETTLED_KEYS_FIELD } from "@/lib/banking/moneyMove";
import { documentHasStamp, settledKeyPush } from "@/lib/bonds/saleRecovery";
import type { UpdateFilter } from "mongodb";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getNewCharacterTransferBarrier,
  NEW_CHARACTER_TRANSFER_BARRIER_TURNS,
} from "@/lib/character/newCharacterTransferBarrier";
import type { CurrencyOrder, Character, TradeHistoryEntry, PlayerMail } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ requestId: string }>;
}

const actionSchema = z.object({
  action: z.enum(["accept", "decline"]),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const forexActive = await isForexEnabled();
    if (!forexActive) throw forbidden("Currency exchange is not yet enabled");

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { requestId } = await params;
    if (!ObjectId.isValid(requestId)) throw badRequest("Invalid request ID");

    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { action } = parsed.data;
    const db = await getDb();
    const character = auth.user.character;

    const order = await db
      .collection<CurrencyOrder>("currencyOrders")
      .findOne({ _id: new ObjectId(requestId) });

    if (!order) throw notFound("Trade request not found");
    if (order.type !== "direct") throw badRequest("Not a direct trade request");
    if (order.status !== "open") throw badRequest("Trade request is no longer open");

    if (
      !order.targetCharacterId ||
      order.targetCharacterId.toString() !== character._id.toString()
    ) {
      throw forbidden("Only the target of this trade request can respond");
    }

    const now = new Date();

    if (action === "decline") {
      const refundInc = buildPersonalBalanceInc(order.amount, order.fromCurrency, true);
      const sender = await db
        .collection<Character>("characters")
        .findOne({ _id: order.characterId });

      await runWithOptionalTransaction(
        async (session) => {
          const claimedOrder = await db
            .collection<CurrencyOrder>("currencyOrders")
            .findOneAndUpdate(
              { _id: order._id, status: "open" },
              { $set: { status: "processing", updatedAt: now } },
              { returnDocument: "before", session }
            );
          if (!claimedOrder) throw badRequest("Trade request is no longer open");

          await db
            .collection("characters")
            .updateOne({ _id: order.characterId }, { $inc: refundInc }, { session });
          const cancelResult = await db
            .collection<CurrencyOrder>("currencyOrders")
            .updateOne(
              { _id: order._id, status: "processing" },
              { $set: { status: "cancelled", updatedAt: now } },
              { session }
            );
          if (cancelResult.matchedCount === 0) {
            throw badRequest("Trade request is no longer open");
          }
        },
        async () => {
          const claimedOrder = await db
            .collection<CurrencyOrder>("currencyOrders")
            .findOneAndUpdate(
              { _id: order._id, status: "open" },
              { $set: { status: "processing", updatedAt: now } },
              { returnDocument: "before" }
            );
          if (!claimedOrder) throw badRequest("Trade request is no longer open");

          // The refund carries a settled-key stamp on the character doc so a
          // later failure can tell "refund landed" from "refund did not land".
          // That decides the recovery: a refunded order must never reopen (a
          // retry would refund the escrow twice, or an accept would settle a
          // trade against money the sender already has back), while an
          // unrefunded order safely can.
          const refundStamp = `direct-decline:${order._id.toString()}`;
          try {
            const refundResult = await db
              .collection<Character>("characters")
              .updateOne({ _id: order.characterId, [SETTLED_KEYS_FIELD]: { $ne: refundStamp } }, {
                $inc: refundInc,
                $push: settledKeyPush(refundStamp),
              } as unknown as UpdateFilter<Character>);
            if (
              refundResult.matchedCount === 0 &&
              !(await documentHasStamp(db, "characters", { _id: order.characterId }, refundStamp))
            ) {
              throw new Error("Escrow refund did not apply");
            }

            const cancelResult = await db
              .collection<CurrencyOrder>("currencyOrders")
              .updateOne(
                { _id: order._id, status: "processing" },
                { $set: { status: "cancelled", updatedAt: now } }
              );
            if (cancelResult.matchedCount === 0) {
              throw badRequest("Trade request is no longer open");
            }
          } catch (error) {
            const refundLanded = await documentHasStamp(
              db,
              "characters",
              { _id: order.characterId },
              refundStamp
            );
            await db.collection<CurrencyOrder>("currencyOrders").updateOne(
              { _id: order._id, status: "processing" },
              {
                $set: {
                  status: refundLanded ? "cancelled" : "open",
                  updatedAt: new Date(),
                },
              }
            );
            throw error;
          }
        }
      );

      if (sender) {
        const mail: Omit<PlayerMail, "_id"> = {
          fromCharacterId: character._id,
          fromCharacterName: character.name,
          fromCharacterSequentialId: character.sequentialId ?? 0,
          toUserId: sender.userId,
          toCharacterId: order.characterId,
          toCharacterName: order.characterName,
          toCharacterSequentialId: sender.sequentialId ?? 0,
          subject: "Trade request declined",
          body: `${character.name} declined your offer to trade ${order.amount.toLocaleString()} ${order.fromCurrency} for ${order.toCurrency}. Your escrowed funds have been returned.`,
          read: false,
          deletedByRecipient: false,
          deletedBySender: false,
          createdAt: now,
        };
        await db.collection<PlayerMail>("playerMail").insertOne(mail as PlayerMail);
      }

      return NextResponse.json({ success: true, action: "declined" });
    }

    // Accepting moves value between the two characters. New characters cannot do so
    // for their first 24 turns (anti-abuse). Declining is allowed above so escrow
    // can always be returned to the counterparty.
    const gameTime = await getGameTime();
    const barrier = getNewCharacterTransferBarrier(
      character,
      gameTime.currentTurn,
      gameTime.effectiveNow.getTime()
    );
    if (barrier.blocked) {
      return NextResponse.json(
        {
          error: `New characters cannot trade currency directly for their first ${NEW_CHARACTER_TRANSFER_BARRIER_TURNS} turns. You can trade in ${barrier.remainingTurns} turn(s).`,
          remainingTurns: barrier.remainingTurns,
        },
        { status: 403 }
      );
    }

    const toCurrencyAmount = order.amount * order.limitRate!;
    const halfSpreadRate = DIRECT_TRADE_SPREAD / 2;
    const senderSpreadFromCurrency = calculateSpreadFee(order.amount, halfSpreadRate);
    const targetSpreadToCurrency = calculateSpreadFee(toCurrencyAmount, halfSpreadRate);

    const targetBalance = getPersonalBalance(character, order.toCurrency, true);
    const targetCost = toCurrencyAmount + targetSpreadToCurrency;
    if (targetBalance < targetCost) {
      throw badRequest(
        `Insufficient ${order.toCurrency}. Need ~${Math.ceil(targetCost).toLocaleString()}, have ${Math.floor(targetBalance).toLocaleString()}.`
      );
    }

    const currentTurn = gameTime.currentTurn;

    const senderCreditInc = buildPersonalBalanceInc(toCurrencyAmount, order.toCurrency, true);
    const senderRollbackInc = buildPersonalBalanceInc(-toCurrencyAmount, order.toCurrency, true);
    // Target receives the traded fromCurrency net of the sender's half-spread.
    // The sender escrowed order.amount fromCurrency at request creation; that
    // escrow now funds both the target credit and the CB spread routed via
    // distributeSpreadFee below. Crediting the target the FULL order.amount while
    // also handing senderSpreadFromCurrency to the CB minted fromCurrency on every
    // accepted trade. Netting: (order.amount - senderSpread) to target + senderSpread
    // to CB = order.amount out of escrow. Conserved.
    const targetFromCurrencyCredit = order.amount - senderSpreadFromCurrency;
    const targetDebitAndCreditInc = {
      ...buildPersonalBalanceInc(-targetCost, order.toCurrency, true),
      ...buildPersonalBalanceInc(targetFromCurrencyCredit, order.fromCurrency, true),
    };
    const targetRollbackInc = {
      ...buildPersonalBalanceInc(targetCost, order.toCurrency, true),
      ...buildPersonalBalanceInc(-targetFromCurrencyCredit, order.fromCurrency, true),
    };
    const fromCountryId = getCountryForCurrency(order.fromCurrency);
    const toCountryId = getCountryForCurrency(order.toCurrency);
    const tradeHistoryEntry = {
      buyerCharacterId: order.characterId,
      sellerCharacterId: character._id,
      fromCurrency: order.fromCurrency,
      toCurrency: order.toCurrency,
      amount: order.amount,
      rate: order.limitRate!,
      spread: senderSpreadFromCurrency,
      turn: currentTurn,
      createdAt: now,
      source: "direct",
    } as TradeHistoryEntry;

    // The spread fee is part of the accepted trade, not a post-fill side
    // effect: it runs INSIDE the transition, after both balances settle and
    // BEFORE the request flips to filled, so a fee failure aborts/rolls back
    // the trade instead of leaving both parties settled with the fee
    // uncollected. Invoked exactly once per closure.
    const spreadFeeLegs = [
      fromCountryId
        ? ([senderSpreadFromCurrency, fromCountryId, order.fromCurrency, toCountryId] as const)
        : null,
      toCountryId
        ? ([targetSpreadToCurrency, toCountryId, order.toCurrency, fromCountryId] as const)
        : null,
    ].filter((leg): leg is NonNullable<typeof leg> => leg !== null);
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
    const restoreClaimedOrder = async () => {
      const restoredFields: Record<string, unknown> = {
        status: "open",
        updatedAt: new Date(),
      };
      const removedFields: Record<string, ""> = {};
      for (const [field, value] of Object.entries({
        filledAmount: order.filledAmount ?? 0,
        filledRate: order.filledRate,
        spreadCharged: order.spreadCharged ?? 0,
      })) {
        if (value === undefined) removedFields[field] = "";
        else restoredFields[field] = value;
      }
      const filledResult = await db.collection<CurrencyOrder>("currencyOrders").updateOne(
        { _id: order._id, status: "filled" },
        {
          $set: restoredFields,
          ...(Object.keys(removedFields).length > 0 ? { $unset: removedFields } : {}),
        }
      );
      if (filledResult.matchedCount > 0) return;

      const processingResult = await db
        .collection<CurrencyOrder>("currencyOrders")
        .updateOne(
          { _id: order._id, status: "processing" },
          { $set: { status: "open", updatedAt: new Date() } }
        );
      if (processingResult.matchedCount === 0) {
        throw new Error("Direct forex request status could not be restored after a failed trade");
      }
    };

    await runWithOptionalTransaction(
      async (session) => {
        const claimedOrder = await db
          .collection<CurrencyOrder>("currencyOrders")
          .findOneAndUpdate(
            { _id: order._id, status: "open" },
            { $set: { status: "processing", updatedAt: now } },
            { returnDocument: "before", session }
          );
        if (!claimedOrder) throw badRequest("Trade request is no longer open");

        const targetUpdate = await db.collection("characters").updateOne(
          {
            _id: character._id,
            [`currencyBalances.personal.${order.toCurrency}`]: { $gte: targetCost },
          },
          { $inc: targetDebitAndCreditInc },
          { session }
        );
        if (targetUpdate.modifiedCount === 0) {
          throw badRequest(
            `Insufficient ${order.toCurrency}. Need ~${Math.ceil(targetCost).toLocaleString()}, have ${Math.floor(targetBalance).toLocaleString()}.`
          );
        }

        await db
          .collection("characters")
          .updateOne({ _id: order.characterId }, { $inc: senderCreditInc }, { session });

        await distributeSpreadFees(session);

        const fillResult = await db.collection<CurrencyOrder>("currencyOrders").updateOne(
          { _id: order._id, status: "processing" },
          {
            $set: {
              status: "filled",
              filledAmount: order.amount,
              filledRate: order.limitRate,
              spreadCharged: senderSpreadFromCurrency,
              updatedAt: now,
            },
          },
          { session }
        );
        if (fillResult.matchedCount === 0) {
          throw badRequest("Trade request is no longer open");
        }
        await db.collection<TradeHistoryEntry>("tradeHistory").insertOne(tradeHistoryEntry, {
          session,
        });
      },
      async () => {
        const claimedOrder = await db
          .collection<CurrencyOrder>("currencyOrders")
          .findOneAndUpdate(
            { _id: order._id, status: "open" },
            { $set: { status: "processing", updatedAt: now } },
            { returnDocument: "before" }
          );
        if (!claimedOrder) throw badRequest("Trade request is no longer open");

        let targetDebited = false;
        let senderCredited = false;
        let spreadFeesApplied = 0;

        try {
          const targetUpdate = await db.collection("characters").updateOne(
            {
              _id: character._id,
              [`currencyBalances.personal.${order.toCurrency}`]: { $gte: targetCost },
            },
            { $inc: targetDebitAndCreditInc }
          );
          if (targetUpdate.modifiedCount === 0) {
            await db
              .collection<CurrencyOrder>("currencyOrders")
              .updateOne(
                { _id: order._id, status: "processing" },
                { $set: { status: "open", updatedAt: new Date() } }
              );
            throw badRequest(
              `Insufficient ${order.toCurrency}. Need ~${Math.ceil(targetCost).toLocaleString()}, have ${Math.floor(targetBalance).toLocaleString()}.`
            );
          }
          targetDebited = true;

          await db
            .collection("characters")
            .updateOne({ _id: order.characterId }, { $inc: senderCreditInc });
          senderCredited = true;

          spreadFeesApplied = await distributeSpreadFees();

          const fillResult = await db.collection<CurrencyOrder>("currencyOrders").updateOne(
            { _id: order._id, status: "processing" },
            {
              $set: {
                status: "filled",
                filledAmount: order.amount,
                filledRate: order.limitRate,
                spreadCharged: senderSpreadFromCurrency,
                updatedAt: now,
              },
            }
          );
          if (fillResult.matchedCount === 0) {
            throw badRequest("Trade request is no longer open");
          }
          await db.collection<TradeHistoryEntry>("tradeHistory").insertOne(tradeHistoryEntry);
        } catch (error) {
          const compensationErrors = await reverseAppliedSpreadFees(spreadFeesApplied);
          if (senderCredited) {
            try {
              await db
                .collection("characters")
                .updateOne({ _id: order.characterId }, { $inc: senderRollbackInc });
            } catch (compensationError) {
              compensationErrors.push(compensationError);
            }
          }
          if (targetDebited) {
            try {
              await db
                .collection("characters")
                .updateOne({ _id: character._id }, { $inc: targetRollbackInc });
            } catch (compensationError) {
              compensationErrors.push(compensationError);
            }
          }
          try {
            await restoreClaimedOrder();
          } catch (compensationError) {
            compensationErrors.push(compensationError);
          }
          if (compensationErrors.length > 0) {
            throw new AggregateError(
              [error, ...compensationErrors],
              "Direct forex trade failed and one or more compensation steps were incomplete"
            );
          }
          throw error;
        }
      }
    );

    const sender = await db.collection<Character>("characters").findOne({ _id: order.characterId });
    if (sender) {
      const mail: Omit<PlayerMail, "_id"> = {
        fromCharacterId: character._id,
        fromCharacterName: character.name,
        fromCharacterSequentialId: character.sequentialId ?? 0,
        toUserId: sender.userId,
        toCharacterId: order.characterId,
        toCharacterName: order.characterName,
        toCharacterSequentialId: sender.sequentialId ?? 0,
        subject: "Trade request accepted",
        body: `${character.name} accepted your trade: ${order.amount.toLocaleString()} ${order.fromCurrency} → ${Math.floor(toCurrencyAmount).toLocaleString()} ${order.toCurrency} at rate ${order.limitRate}. Spread: ${senderSpreadFromCurrency.toFixed(2)} ${order.fromCurrency}.`,
        read: false,
        deletedByRecipient: false,
        deletedBySender: false,
        createdAt: now,
      };
      await db.collection<PlayerMail>("playerMail").insertOne(mail as PlayerMail);
    }

    return NextResponse.json({
      success: true,
      action: "accepted",
      trade: {
        fromCurrency: order.fromCurrency,
        toCurrency: order.toCurrency,
        amount: order.amount,
        rate: order.limitRate,
        senderSpread: senderSpreadFromCurrency,
        targetSpread: targetSpreadToCurrency,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
