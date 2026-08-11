import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { createNotification } from "@/lib/notifications";
import { emitTx } from "@/lib/financialTxLog/emit";
import { isSameCountry } from "@/lib/api/sameCountry";
import { getGameTime } from "@/lib/time/gameTime";
import {
  getNewCharacterTransferBarrier,
  NEW_CHARACTER_TRANSFER_BARRIER_TURNS,
} from "@/lib/character/newCharacterTransferBarrier";
import { z } from "zod";
import type { Character, User } from "@/lib/db/types";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getPersonalBalance,
  buildPersonalBalanceInc,
  getHomeCurrency,
  loadCharacterFxRate,
} from "@/lib/currency/characterFunds";
import {
  FOREX_ACTIVE_CURRENCIES,
  CURRENCY_SYMBOLS,
  type CurrencyCode,
} from "@/lib/constants/currencies";

const wireSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.enum(FOREX_ACTIVE_CURRENCIES as [CurrencyCode, ...CurrencyCode[]]).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ₳50M per 24h in anchor units. Normalises across currencies so a JPY player
// can't exploit a higher nominal cap. Tunable without a schema change.
const DAILY_WIRE_CAP_ANCHORS = 50_000_000;
const WIRE_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

// POST /api/characters/[id]/wire — Wires personal cash on hand from the authenticated character to another character
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, wireSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { amount, currency: requestedCurrency } = parsed.data;

    const { id: targetId } = await params;
    if (!ObjectId.isValid(targetId)) {
      return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
    }
    const targetObjectId = new ObjectId(targetId);

    const db = await getDb();
    const forexEnabled = await isForexEnabled();

    const sender = await getCharacterByUserId(db, user.userId);
    if (!sender) {
      return NextResponse.json({ error: "You need a character to send funds" }, { status: 400 });
    }

    if (sender._id.equals(targetObjectId)) {
      return NextResponse.json({ error: "You cannot wire funds to yourself" }, { status: 400 });
    }

    const [target, userDoc] = await Promise.all([
      db.collection<Character>("characters").findOne({ _id: targetObjectId }),
      db
        .collection<User>("users")
        .findOne(
          { _id: new ObjectId(user.userId) },
          { projection: { wireQuotaUsed: 1, wireQuotaWindowStart: 1 } }
        ),
    ]);

    if (!target) {
      return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
    }

    // Personal cash may be wired internationally when forex is enabled: the currency
    // travels with the transfer (the recipient is credited in the same currency
    // bucket), so no FX conversion is involved and the anchor-denominated daily cap
    // still applies. Campaign funds remain home-country only (see /transfer).
    // Pre-forex there is a single unitless cash pool with no currency semantics, so
    // cross-border wires stay blocked in that mode.
    if (!forexEnabled && !isSameCountry(sender, target)) {
      return NextResponse.json(
        { error: "You cannot wire funds to politicians from other countries" },
        { status: 400 }
      );
    }

    // New characters cannot send money for their first 24 turns (anti-abuse).
    const gameTime = await getGameTime();
    const barrier = getNewCharacterTransferBarrier(
      sender,
      gameTime.currentTurn,
      gameTime.effectiveNow.getTime()
    );
    if (barrier.blocked) {
      return NextResponse.json(
        {
          error: `New characters cannot send funds for their first ${NEW_CHARACTER_TRANSFER_BARRIER_TURNS} turns. You can send funds in ${barrier.remainingTurns} turn(s).`,
          remainingTurns: barrier.remainingTurns,
        },
        { status: 403 }
      );
    }

    // Pre-forex: legacy single-pool cashOnHand. Reject explicit currency selection since
    // there are no per-currency buckets to draw from.
    if (!forexEnabled && requestedCurrency && requestedCurrency !== getHomeCurrency(sender)) {
      return NextResponse.json(
        { error: "Foreign-currency transfers are not available" },
        { status: 400 }
      );
    }

    // Transfer currency: default to sender's home. When forex is on, the sender may also
    // wire any foreign currency they hold — recipient receives it in the same currency.
    const transferCurrency: CurrencyCode = requestedCurrency ?? getHomeCurrency(sender);

    const senderBalance = getPersonalBalance(sender, transferCurrency, forexEnabled);
    if (senderBalance < amount) {
      return NextResponse.json(
        { error: `Insufficient ${transferCurrency} balance` },
        { status: 400 }
      );
    }

    // Convert the transfer amount to anchor units for a currency-neutral daily cap.
    // When forex is disabled, USD is treated as 1:1 with anchors (pre-forex behaviour).
    let charFxRate = 1.0;
    if (forexEnabled) {
      const fxResult = await loadCharacterFxRate(db, getHomeCurrency(sender));
      if (!fxResult.ok) {
        return NextResponse.json(
          { error: "Exchange rate unavailable, try again shortly" },
          { status: 503 }
        );
      }
      charFxRate = fxResult.rate;
    }
    const anchorAmount = forexEnabled ? amount / charFxRate : amount;
    const now = new Date();
    const quotaWindowCutoff = new Date(now.getTime() - WIRE_QUOTA_WINDOW_MS);

    // Daily wire quota: resets after 24h. Tracked in anchor units on the user document.
    const windowStart = userDoc?.wireQuotaWindowStart
      ? new Date(userDoc.wireQuotaWindowStart)
      : null;
    const windowFresh =
      windowStart !== null && now.getTime() - windowStart.getTime() < WIRE_QUOTA_WINDOW_MS;
    const quotaUsed = windowFresh ? (userDoc?.wireQuotaUsed ?? 0) : 0;
    if (quotaUsed + anchorAmount > DAILY_WIRE_CAP_ANCHORS) {
      const remaining = Math.max(0, DAILY_WIRE_CAP_ANCHORS - quotaUsed);
      return NextResponse.json(
        {
          error: `Daily wire limit reached. ₳${Math.floor(remaining).toLocaleString()} remaining in your quota.`,
        },
        { status: 429 }
      );
    }

    const userObjectId = new ObjectId(user.userId);
    const claimFreshQuota = () =>
      db.collection("users").updateOne(
        {
          _id: userObjectId,
          wireQuotaWindowStart: { $gte: quotaWindowCutoff },
          wireQuotaUsed: { $lte: DAILY_WIRE_CAP_ANCHORS - anchorAmount },
        },
        { $inc: { wireQuotaUsed: anchorAmount }, $set: { updatedAt: now } }
      );
    const claimResetQuota = () =>
      db.collection("users").updateOne(
        {
          _id: userObjectId,
          $or: [
            { wireQuotaWindowStart: { $exists: false } },
            { wireQuotaWindowStart: { $lt: quotaWindowCutoff } },
          ],
        },
        { $set: { wireQuotaUsed: anchorAmount, wireQuotaWindowStart: now, updatedAt: now } }
      );

    let quotaClaimMode: "fresh" | "reset" | null = null;
    if (windowFresh) {
      const quotaClaim = await claimFreshQuota();
      if (quotaClaim.modifiedCount > 0) {
        quotaClaimMode = "fresh";
      }
    } else {
      const resetClaim = await claimResetQuota();
      if (resetClaim.modifiedCount > 0) {
        quotaClaimMode = "reset";
      } else {
        const freshClaim = await claimFreshQuota();
        if (freshClaim.modifiedCount > 0) {
          quotaClaimMode = "fresh";
        }
      }
    }

    if (!quotaClaimMode) {
      const latestUserDoc = await db
        .collection<User>("users")
        .findOne(
          { _id: userObjectId },
          { projection: { wireQuotaUsed: 1, wireQuotaWindowStart: 1 } }
        );
      const latestWindowStart = latestUserDoc?.wireQuotaWindowStart
        ? new Date(latestUserDoc.wireQuotaWindowStart)
        : null;
      const latestFresh =
        latestWindowStart !== null &&
        now.getTime() - latestWindowStart.getTime() < WIRE_QUOTA_WINDOW_MS;
      const latestQuotaUsed = latestFresh ? (latestUserDoc?.wireQuotaUsed ?? 0) : 0;
      const remaining = Math.max(0, DAILY_WIRE_CAP_ANCHORS - latestQuotaUsed);
      return NextResponse.json(
        {
          error: `Daily wire limit reached. ₳${Math.floor(remaining).toLocaleString()} remaining in your quota.`,
        },
        { status: 429 }
      );
    }

    const rollbackQuotaClaim = async () => {
      if (quotaClaimMode === "fresh") {
        await db
          .collection("users")
          .updateOne(
            { _id: userObjectId, wireQuotaWindowStart: { $gte: quotaWindowCutoff } },
            { $inc: { wireQuotaUsed: -anchorAmount }, $set: { updatedAt: new Date() } }
          );
        return;
      }

      const resetRollback: Record<string, unknown> = {
        updatedAt: new Date(),
      };
      if (userDoc?.wireQuotaWindowStart) {
        resetRollback.wireQuotaWindowStart = userDoc.wireQuotaWindowStart;
      }
      if (userDoc?.wireQuotaUsed !== undefined) {
        resetRollback.wireQuotaUsed = userDoc.wireQuotaUsed;
      } else {
        await db.collection("users").updateOne(
          { _id: userObjectId },
          {
            $unset: { wireQuotaUsed: "", wireQuotaWindowStart: "" },
            $set: { updatedAt: new Date() },
          }
        );
        return;
      }

      await db.collection("users").updateOne({ _id: userObjectId }, { $set: resetRollback });
    };

    const atomicFilter = forexEnabled
      ? { _id: sender._id, [`currencyBalances.personal.${transferCurrency}`]: { $gte: amount } }
      : { _id: sender._id, cashOnHand: { $gte: amount } };

    const senderUpdate = await db.collection<Character>("characters").updateOne(atomicFilter, {
      $inc: { ...buildPersonalBalanceInc(-amount, transferCurrency, forexEnabled) },
      $set: { updatedAt: now },
    });

    if (senderUpdate.modifiedCount === 0) {
      await rollbackQuotaClaim();
      return NextResponse.json(
        { error: `Insufficient ${transferCurrency} balance` },
        { status: 400 }
      );
    }

    const senderRollbackInc = buildPersonalBalanceInc(amount, transferCurrency, forexEnabled);
    const recipientCreditResult = await db.collection<Character>("characters").updateOne(
      { _id: targetObjectId },
      {
        $inc: { ...buildPersonalBalanceInc(amount, transferCurrency, forexEnabled) },
        $set: { updatedAt: now },
      }
    );
    if (recipientCreditResult.modifiedCount === 0) {
      await db
        .collection<Character>("characters")
        .updateOne(
          { _id: sender._id },
          { $inc: senderRollbackInc, $set: { updatedAt: new Date() } }
        );
      await rollbackQuotaClaim();
      return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
    }

    // wire_transfer_out (sender) + wire_transfer_in (recipient). Pre-Phase-3
    // wires moved cash silently between two character wallets — admin queries
    // could see the daily-quota usage but not the per-transfer detail. Phase 3
    // emits one row on each side, cross-linked via counterpartyId.
    void emitTx(db, {
      type: "wire_transfer_out",
      turn: 0,
      createdAt: now,
      subjectType: "character",
      subjectId: sender._id,
      subjectName: sender.name,
      amount: -amount,
      currencyCode: transferCurrency,
      counterpartyType: "character",
      counterpartyId: target._id,
      counterpartyName: target.name,
      meta: { wireAnchorAmount: anchorAmount },
    });
    void emitTx(db, {
      type: "wire_transfer_in",
      turn: 0,
      createdAt: now,
      subjectType: "character",
      subjectId: target._id,
      subjectName: target.name,
      amount,
      currencyCode: transferCurrency,
      counterpartyType: "character",
      counterpartyId: sender._id,
      counterpartyName: sender.name,
      meta: { wireAnchorAmount: anchorAmount },
    });

    const symbol = CURRENCY_SYMBOLS[transferCurrency] ?? "$";
    const formattedAmount =
      transferCurrency === "JPY"
        ? `${symbol}${Math.round(amount).toLocaleString()}`
        : `${symbol}${amount.toLocaleString()}`;

    if (target.userId) {
      await createNotification({
        userId: target.userId,
        type: "wire_received",
        title: "Wire Transfer Received",
        message: `${sender.name} wired you ${formattedAmount}.`,
        metadata: {
          senderId: sender._id.toString(),
          senderName: sender.name,
          amount,
          currency: transferCurrency,
        },
      });
    }

    return NextResponse.json({
      success: true,
      amount,
      currency: transferCurrency,
      remainingBalance: senderBalance - amount,
      // Legacy field used by pre-forex clients. In forex mode this equals the remaining
      // balance in the currency that was sent, which is what the caller actually needs.
      remainingCashOnHand: senderBalance - amount,
      recipientName: target.name,
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/characters/[id]/wire" });
  }
}
