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
import {
  applyForexCancelSpend,
  applyForexFillSpend,
  FOREX_CANCEL_ORDER_MISSING,
  FOREX_CANCEL_UNAVAILABLE,
  FOREX_DIRECT_INSUFFICIENT,
  FOREX_DIRECT_ORDER_MISSING,
  FOREX_DIRECT_UNAVAILABLE,
  FOREX_DIRECT_WRONG_TYPE,
} from "@/lib/forex/forexSpend";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getNewCharacterTransferBarrier,
  NEW_CHARACTER_TRANSFER_BARRIER_TURNS,
} from "@/lib/character/newCharacterTransferBarrier";
import type { CurrencyOrder, Character, PlayerMail } from "@/lib/db/types";

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

    // Crash-safe decline/accept (issue #1672): both run as keyed idempotent
    // money flows, so a crash between the sequential writes reconciles to
    // exactly one outcome and a concurrent accept/decline race compensates
    // the loser. `Idempotency-Key` replays the stored outcome without moving
    // money again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    if (action === "decline") {
      const sender = await db
        .collection<Character>("characters")
        .findOne({ _id: order.characterId });

      let decline: Awaited<ReturnType<typeof applyForexCancelSpend>>;
      try {
        decline = await applyForexCancelSpend(db, {
          orderId: order._id,
          now,
          fingerprint: `forex-decline:${order._id.toHexString()}:${character._id.toHexString()}`,
          ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
        });
      } catch (error) {
        if (error instanceof Error && error.message === FOREX_CANCEL_ORDER_MISSING) {
          throw notFound("Trade request not found");
        }
        if (
          error instanceof Error &&
          (error.message === FOREX_CANCEL_UNAVAILABLE ||
            error.message.startsWith("FOREX_CANCEL_order-cancel:"))
        ) {
          throw badRequest("Trade request is no longer open");
        }
        if (error instanceof MoneyFlowTerminalError) {
          return NextResponse.json(
            { error: "This decline already settled. Start a new request to try again." },
            { status: 409 }
          );
        }
        if (error instanceof MoneyFlowKeyConflictError) {
          return NextResponse.json(
            { error: "This idempotency key was already used for a different decline." },
            { status: 409 }
          );
        }
        throw error;
      }

      if (!decline.duplicate && sender) {
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

    // The taker settlement, sender credit, guarded accept transition, history
    // row, and both half-spread CB slices run as keyed idempotent steps inside
    // the primitive (same conservation and routing as the legacy writes); the
    // live balance pre-check moves in there too so the 400 echoes exact
    // need/have numbers.
    const currentTurn = gameTime.currentTurn;

    let fill: Awaited<ReturnType<typeof applyForexFillSpend>>;
    try {
      fill = await applyForexFillSpend(db, {
        kind: "direct",
        orderId: order._id,
        takerCharacterId: character._id,
        now,
        turn: currentTurn,
        fingerprint: `forex-direct:${order._id.toHexString()}:${character._id.toHexString()}`,
        ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.message === FOREX_DIRECT_ORDER_MISSING) {
        throw notFound("Trade request not found");
      }
      if (error instanceof Error && error.message === FOREX_DIRECT_WRONG_TYPE) {
        throw badRequest("Not a direct trade request");
      }
      if (error instanceof Error && error.message === FOREX_DIRECT_UNAVAILABLE) {
        throw badRequest("Trade request is no longer open");
      }
      if (error instanceof Error && error.message.startsWith(FOREX_DIRECT_INSUFFICIENT)) {
        const parts = error.message.split(":");
        if (parts[1] === "precheck" && parts.length === 4) {
          const need = Number(parts[2]);
          const have = Number(parts[3]);
          if (Number.isFinite(need) && Number.isFinite(have)) {
            throw badRequest(
              `Insufficient ${order.toCurrency}. Need ~${Math.ceil(need).toLocaleString()}, have ${Math.floor(have).toLocaleString()}.`
            );
          }
        }
        throw badRequest(`Insufficient ${order.toCurrency} balance`);
      }
      if (error instanceof MoneyFlowTerminalError) {
        return NextResponse.json(
          { error: "This accept already settled. Start a new request to try again." },
          { status: 409 }
        );
      }
      if (error instanceof MoneyFlowKeyConflictError) {
        return NextResponse.json(
          { error: "This idempotency key was already used for a different accept." },
          { status: 409 }
        );
      }
      throw error;
    }

    const toCurrencyAmount = fill.fillAmount * fill.rate;
    const senderSpreadFromCurrency = fill.makerSpread;
    const targetSpreadToCurrency = fill.takerSpread;

    const sender = await db.collection<Character>("characters").findOne({ _id: order.characterId });
    if (!fill.duplicate && sender) {
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
