import { euroLedgerCrossRate, type EuroMonetaryUnion } from "@/lib/currency/euro/rules";
import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import type { CurrencyOrder } from "@/lib/db/types/currencyOrder";
import type { TradeHistoryEntry } from "@/lib/db/types/tradeHistory";
import type { Character } from "@/lib/db/types/character";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  LIMIT_ORDER_SPREAD,
  SPREAD_FEE_CENTRAL_BANK_RATIO,
  SPREAD_FEE_RESERVE_RATIO,
  CURRENCY_SYMBOLS,
} from "@/lib/constants/currencies";
import { playerTradeFeeRate, recentVolumeAnchorOf } from "@/lib/currency/tradeFees";
import { loadTraderRecentForexAnchor } from "@/lib/currency/traderForexVolume";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { recoverStaleFillClaims } from "@/lib/forex/fillRecovery";
import { sendSystemMail } from "@/lib/mail/systemMail";
import { getBankId } from "@/lib/centralBank/helpers";

// ── Limit order processing ──────────────────────────────────────────────────

interface FilledOrderNotification {
  characterId: ObjectId;
  characterName: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  spentAmount: number;
  receivedAmount: number;
  filledRate: number;
}

interface LimitOrderResult {
  ordersFilled: number;
  totalSpreadRevenue: number;
  notifications: FilledOrderNotification[];
}

/**
 * Scan open limit orders and fill any whose limit price is met by the
 * current exchange rate. Executes against the market maker at the
 * prevailing rate. Priority: FIFO (oldest order first).
 *
 * Spread revenue is split: 50% destroyed, 50% to central bank.
 *
 * Crash-safety: each order is atomically claimed (open/partial → processing)
 * before any credits are applied. If the process dies after claiming but
 * before completing, the order is left in "processing" (not "open"), so it
 * will not be replayed on the next turn. Orders stuck in "processing" for
 * more than 2 turns are recovered at the start of this function.
 */
export async function processTriggeredLimitOrders(
  db: Db,
  currentTurn: number,
  now: Date,
  union?: EuroMonetaryUnion
): Promise<LimitOrderResult> {
  // ── Stuck-order recovery ──────────────────────────────────────────────────
  // Orders left in "processing" from a prior crash are safe to re-attempt:
  // they were claimed but never completed. Reset them to "open" so they are
  // picked up in this turn's scan below. 2-turn window = 2 real-time hours.
  //
  // Claims carrying a peer-fill intent are EXCLUDED from the blind reset: a
  // fill may already have moved money, and resetting to open would strand it.
  // Those go through intent recovery (finish or undo) instead.
  await db.collection<CurrencyOrder>("currencyOrders").updateMany(
    {
      status: "processing",
      updatedAt: { $lt: new Date(now.getTime() - 2 * MS_PER_TURN) },
      processingFillKey: { $exists: false },
    },
    { $set: { status: "open" as const, updatedAt: now } }
  );
  await recoverStaleFillClaims(db, now);

  // Load current rates into a map for quick lookup
  const rates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  const rateMap = new Map(rates.map((r) => [r.currencyCode, r.rate]));

  // Find open/partial limit orders, sorted by creation date (FIFO)
  const openOrders = await db
    .collection<CurrencyOrder>("currencyOrders")
    .find({
      type: "limit",
      status: { $in: ["open", "partial"] },
    })
    .sort({ createdAt: 1 })
    .toArray();

  let ordersFilled = 0;
  let totalSpreadRevenue = 0;
  const notifications: FilledOrderNotification[] = [];

  for (const order of openOrders) {
    if (order.limitRate === undefined) continue;

    const fromRate = rateMap.get(order.fromCurrency) ?? 1;
    const toRate = rateMap.get(order.toCurrency) ?? 1;

    // Cross rate: how many toCurrency units per 1 fromCurrency unit
    // Both rates are "local currency per 1 internal unit"
    // crossRate = toRate / fromRate
    const fixedRate = euroLedgerCrossRate(union, order.fromCurrency, order.toCurrency);
    const crossRate = fixedRate ?? toRate / fromRate;

    // If the rate document was malformed this turn (e.g. a NaN cascade like
    // the turn-269 incident upstream), skip the order rather than filling
    // it at Infinity/NaN and poisoning the destination balance via $inc.
    // The order re-evaluates next turn once rates recover.
    if (!Number.isFinite(crossRate) || crossRate <= 0) continue;

    // Buy: fill when cross rate >= limit (player gets at least as much toCurrency as expected)
    // Sell: fill when cross rate <= limit (player gets at least as much fromCurrency as expected)
    const isBuy = order.direction !== "sell";
    const isFillable = isBuy ? crossRate >= order.limitRate : crossRate <= order.limitRate;

    if (!isFillable) continue;

    const remainingAmount = order.amount - order.filledAmount;
    if (remainingAmount <= 0 || (fixedRate != null && Math.floor(remainingAmount * crossRate) <= 0))
      continue;

    // ── Atomic claim: open/partial → processing ───────────────────────────
    // This is the idempotency guard. If the process crashes after this point
    // the order stays in "processing", not "open", and will not be replayed.
    const claimResult = await db
      .collection<CurrencyOrder>("currencyOrders")
      .updateOne(
        { _id: order._id, status: { $in: ["open", "partial"] } },
        { $set: { status: "processing" as const, updatedAt: now } }
      );
    if (claimResult.modifiedCount === 0) {
      // Another process already claimed it (or it was cancelled/expired concurrently).
      continue;
    }

    // Calculate spread on the remaining fill. A limit order is a player's own
    // trade, so on top of the cheaper limit spread it pays the same size and
    // liquidity fee as an instant trade; otherwise it would be the way around it.
    const fillAnchor = fixedRate == null && fromRate > 0 ? remainingAmount / fromRate : undefined;
    const limitFeeRate =
      fillAnchor === undefined
        ? 0
        : playerTradeFeeRate({
            baseSpread: LIMIT_ORDER_SPREAD,
            tradeAnchor: fillAnchor,
            priorAnchor: await loadTraderRecentForexAnchor(db, order.characterId, currentTurn),
            fromVolumeAnchor: recentVolumeAnchorOf(
              rates.find((r) => r.currencyCode === order.fromCurrency)
            ),
            toVolumeAnchor: recentVolumeAnchorOf(
              rates.find((r) => r.currencyCode === order.toCurrency)
            ),
          });
    const spreadAmount = fixedRate == null ? remainingAmount * limitFeeRate : 0;
    const netAmount = remainingAmount - spreadAmount;
    const centralBankShare = spreadAmount * SPREAD_FEE_CENTRAL_BANK_RATIO;

    // Convert net fromCurrency to toCurrency at current cross rate
    const toAmount = fixedRate == null ? netAmount * crossRate : Math.floor(netAmount * crossRate);

    totalSpreadRevenue += centralBankShare;

    // Split the central bank share per the SPREAD_FEE_*_RATIO constants.
    // forexRevenue (home revenue) stays with the fromCurrency country's CB. The
    // reserve slice stays denominated in the collected fromCurrency but accrues
    // to the *destination* (toCurrency) country's CB as a foreign reserve in the
    // outflow currency — mirroring distributeSpreadFee's cross-currency routing.
    // Use getBankId so shared-bank countries route to the correct bank document.
    const fromCountryEntry = rates.find((r) => r.currencyCode === order.fromCurrency);
    if (fromCountryEntry && spreadAmount > 0) {
      const toReserveBalance = Math.floor(spreadAmount * SPREAD_FEE_RESERVE_RATIO);
      const toForexRevenue = centralBankShare - toReserveBalance;
      const fromBankId = getBankId(fromCountryEntry.countryId as Parameters<typeof getBankId>[0]);
      const toCountryEntry = rates.find((r) => r.currencyCode === order.toCurrency);
      const reserveBankId = toCountryEntry
        ? getBankId(toCountryEntry.countryId as Parameters<typeof getBankId>[0])
        : fromBankId;
      const banks = db.collection<CentralBank>("centralBanks");
      if (reserveBankId === fromBankId) {
        await banks.updateOne(
          { _id: fromBankId },
          {
            $inc: {
              forexRevenue: toForexRevenue,
              [`spreadFeeReserveBalances.${order.fromCurrency}`]: toReserveBalance,
            } as Record<string, number>,
          },
          { upsert: true }
        );
      } else {
        await Promise.all([
          banks.updateOne(
            { _id: fromBankId },
            { $inc: { forexRevenue: toForexRevenue } as Record<string, number> },
            { upsert: true }
          ),
          toReserveBalance > 0
            ? banks.updateOne(
                { _id: reserveBankId },
                {
                  $inc: {
                    [`spreadFeeReserveBalances.${order.fromCurrency}`]: toReserveBalance,
                  } as Record<string, number>,
                },
                { upsert: true }
              )
            : Promise.resolve(),
        ]);
      }
    }

    // Credit the purchased toCurrency to the character's personal balance.
    // The fromCurrency was escrowed at order creation time — no deduction needed here.
    const creditInc = buildPersonalBalanceInc(toAmount, order.toCurrency, true);
    const creditResult = await db
      .collection("characters")
      .updateOne({ _id: order.characterId }, { $inc: creditInc });

    // Character was deleted between order creation and fill — cancel the order
    // so it doesn't retry every turn. Escrowed funds are unrecoverable.
    // Record the trade for audit trail since spread was already collected.
    if (creditResult.modifiedCount === 0) {
      await db.collection<TradeHistoryEntry>("tradeHistory").insertOne({
        buyerCharacterId: order.characterId,
        sellerCharacterId: null,
        fromCurrency: order.fromCurrency,
        toCurrency: order.toCurrency,
        amount: netAmount,
        rate: crossRate,
        spread: spreadAmount,
        ...(fillAnchor !== undefined ? { anchorAmount: fillAnchor } : {}),
        turn: currentTurn,
        createdAt: now,
        source: "limit_order",
      } as TradeHistoryEntry);

      await db
        .collection<CurrencyOrder>("currencyOrders")
        .updateOne({ _id: order._id }, { $set: { status: "expired" as const, updatedAt: now } });
      continue;
    }

    // forexEnabled is always true here — this phase only runs inside the gameState.forexEnabled gate
    // Record trade history entry
    await db.collection<TradeHistoryEntry>("tradeHistory").insertOne({
      buyerCharacterId: order.characterId,
      sellerCharacterId: null, // market maker
      fromCurrency: order.fromCurrency,
      toCurrency: order.toCurrency,
      amount: netAmount,
      rate: crossRate,
      spread: spreadAmount,
      ...(fillAnchor !== undefined ? { anchorAmount: fillAnchor } : {}),
      turn: currentTurn,
      createdAt: now,
      source: "limit_order",
    } as TradeHistoryEntry);

    // Update order to its terminal status (filled or partial)
    const newFilledAmount = order.filledAmount + remainingAmount;
    const newStatus = newFilledAmount >= order.amount ? "filled" : "partial";

    await db.collection<CurrencyOrder>("currencyOrders").updateOne(
      { _id: order._id },
      {
        $set: {
          status: newStatus,
          filledAmount: newFilledAmount,
          filledRate: crossRate,
          updatedAt: now,
        },
        $inc: { spreadCharged: spreadAmount },
      }
    );

    notifications.push({
      characterId: order.characterId,
      characterName: order.characterName,
      fromCurrency: order.fromCurrency,
      toCurrency: order.toCurrency,
      spentAmount: remainingAmount,
      receivedAmount: toAmount,
      filledRate: crossRate,
    });
    ordersFilled++;
  }

  return { ordersFilled, totalSpreadRevenue, notifications };
}

/**
 * Expiry claims retain a refund marker until the wallet write completes.
 * Stamped credits make an interrupted batch safe to retry on the next turn.
 */
export async function expireStaleOrders(db: Db, currentTurn: number, now: Date): Promise<number> {
  const orders = db.collection<CurrencyOrder>("currencyOrders");
  const transitionResult = await orders.updateMany(
    { status: { $in: ["open", "partial"] }, expiresAtTurn: { $lte: currentTurn } },
    { $set: { status: "expired" as const, expiryRefundState: "pending", updatedAt: now } }
  );
  // Include interrupted earlier turns, even when no new order expires today.
  // Legacy expired rows without a marker are excluded: their refund status
  // cannot be inferred safely from the terminal status alone.
  const pending = await orders
    .find(
      { status: "expired", expiryRefundState: { $in: ["pending", "credited"] } },
      {
        projection: {
          characterId: 1,
          fromCurrency: 1,
          amount: 1,
          filledAmount: 1,
          expiryRefundState: 1,
        },
      }
    )
    .toArray();
  const refundOps: AnyBulkWriteOperation<Character>[] = [];
  for (const order of pending) {
    if (order.expiryRefundState === "credited") continue;
    const refundAmount = order.amount - order.filledAmount;
    if (refundAmount <= 0) continue;
    const stamp = `forex-expiry:${String(order._id)}#refund`;
    refundOps.push({
      updateOne: {
        filter: { _id: order.characterId, forexExpiryRefunds: { $ne: stamp } },
        update: {
          $inc: buildPersonalBalanceInc(refundAmount, order.fromCurrency, true),
          $addToSet: { forexExpiryRefunds: stamp },
        },
      },
    });
  }
  if (refundOps.length) await db.collection<Character>("characters").bulkWrite(refundOps);
  if (pending.length)
    await orders.updateMany(
      {
        _id: { $in: pending.map((order) => order._id) },
        status: "expired",
        expiryRefundState: "pending",
      },
      { $set: { expiryRefundState: "credited" } }
    );
  // Keep recovery receipts outside the capped general payment history. They
  // cannot age out while a refund is awaiting acknowledgement. The serialized
  // turn phase releases them only after the order records the credited state.
  const cleanupOps: AnyBulkWriteOperation<Character>[] = pending.map((order) => ({
    updateOne: {
      filter: { _id: order.characterId },
      update: { $pull: { forexExpiryRefunds: `forex-expiry:${String(order._id)}#refund` } },
    },
  }));
  if (cleanupOps.length) {
    await db.collection<Character>("characters").bulkWrite(cleanupOps);
    await orders.updateMany(
      {
        _id: { $in: pending.map((order) => order._id) },
        status: "expired",
        expiryRefundState: "credited",
      },
      { $unset: { expiryRefundState: "" } }
    );
  }
  return transitionResult.modifiedCount;
}

/**
 * Send in-game mail to each character whose limit order filled this turn.
 * Batches the character lookup — one query for all unique characterIds.
 */
export async function sendFillNotifications(
  db: Db,
  notifications: FilledOrderNotification[]
): Promise<void> {
  if (notifications.length === 0) return;

  const uniqueOids = notifications
    .filter(
      (n, i, arr) =>
        arr.findIndex((x) => x.characterId.toString() === n.characterId.toString()) === i
    )
    .map((n) => n.characterId);

  const chars = await db
    .collection<Character>("characters")
    .find(
      { _id: { $in: uniqueOids } },
      { projection: { _id: 1, userId: 1, name: 1, sequentialId: 1 } }
    )
    .toArray();

  const charMap = new Map(chars.map((c) => [c._id.toString(), c]));

  for (const note of notifications) {
    const char = charMap.get(note.characterId.toString());
    if (!char) continue;

    const fromSym = CURRENCY_SYMBOLS[note.fromCurrency] ?? note.fromCurrency;
    const toSym = CURRENCY_SYMBOLS[note.toCurrency] ?? note.toCurrency;
    const rate = note.filledRate.toFixed(4);
    const spent = note.spentAmount.toLocaleString("en-US", { maximumFractionDigits: 2 });
    const received = note.receivedAmount.toLocaleString("en-US", { maximumFractionDigits: 2 });

    await sendSystemMail(db, {
      toCharacterId: char._id,
      toCharacterName: char.name,
      toCharacterSequentialId: char.sequentialId ?? 0,
      toUserId: char.userId,
      subject: "Limit Order Filled",
      body: `Your limit order to exchange ${fromSym}${spent} ${note.fromCurrency} → ${note.toCurrency} has filled at a rate of ${rate}. You received ${toSym}${received} ${note.toCurrency}.`,
    });
  }
}
