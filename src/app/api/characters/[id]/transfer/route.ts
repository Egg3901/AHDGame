import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseObjectId } from "@/lib/utils/objectId";
import { parseJsonBody } from "@/lib/api/validate";
import { characterTransferSchema } from "@/lib/api/schemas/settings";
import type { Character } from "@/lib/db/types";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { getGameTime } from "@/lib/time/gameTime";
import { emitTx } from "@/lib/financialTxLog/emit";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { isSameCountry } from "@/lib/api/sameCountry";
import {
  getNewCharacterTransferBarrier,
  NEW_CHARACTER_TRANSFER_BARRIER_TURNS,
} from "@/lib/character/newCharacterTransferBarrier";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/characters/[id]/transfer — Transfers campaign funds from the authenticated character to another character
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, characterTransferSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const transferAmount = parsed.data.amount;
    const { id: targetId } = await params;

    const targetObjectId = parseObjectId(targetId);
    if (!targetObjectId) {
      return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
    }

    const db = await getDb();
    const [transferGuard, forexEnabled] = await Promise.all([
      requirePlayerTransfersEnabled(db),
      isForexEnabled(),
    ]);
    if (transferGuard) return transferGuard;

    const sender = await getCharacterByUserId(db, user.userId);
    if (!sender) {
      return NextResponse.json(
        { error: "You need a character to transfer funds" },
        { status: 400 }
      );
    }

    const senderCurrency = getHomeCurrency(sender);
    const { rate: homeFxRate } = forexEnabled
      ? await loadCharacterFxRate(db, senderCurrency)
      : { rate: 1 };
    // `amount` is denominated in the sender's LOCAL home currency (¥, £, etc.) —
    // the same unit stored in `currencyBalances.campaign`. Transfers are always
    // same-country (assertion below), so sender and recipient share a currency and
    // no FX conversion is involved. (homeFxRate is retained only to express the
    // post-transfer balance in anchor units for the achievement check.)
    const transferAmountLocal = transferAmount;

    if (sender._id.equals(targetObjectId)) {
      return NextResponse.json({ error: "You cannot transfer funds to yourself" }, { status: 400 });
    }

    if (localCampaignBalance(sender, forexEnabled) < transferAmountLocal) {
      return NextResponse.json({ error: "Insufficient funds" }, { status: 400 });
    }

    const target = await db.collection<Character>("characters").findOne({ _id: targetObjectId });
    if (!target) {
      return NextResponse.json({ error: "Target character not found" }, { status: 404 });
    }

    if (!isSameCountry(sender, target)) {
      return NextResponse.json(
        { error: "You cannot transfer funds to politicians from other countries" },
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

    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
    const atomicFilter: Record<string, unknown> = {
      _id: sender._id,
      [campaignFundsField]: { $gte: transferAmountLocal },
    };

    const senderDebit = { $inc: { [campaignFundsField]: -transferAmountLocal } };
    const targetCredit = { $inc: { [campaignFundsField]: transferAmountLocal } };

    await runWithOptionalTransaction(
      async (session) => {
        const senderUpdate = await db
          .collection<Character>("characters")
          .updateOne(atomicFilter, senderDebit, { session });
        if (senderUpdate.modifiedCount === 0) {
          throw new Error("INSUFFICIENT_FUNDS");
        }

        const targetUpdate = await db
          .collection<Character>("characters")
          .updateOne({ _id: targetObjectId }, targetCredit, { session });
        if (targetUpdate.matchedCount === 0) {
          throw new Error("TARGET_NOT_FOUND");
        }
      },
      async () => {
        const senderUpdate = await db
          .collection<Character>("characters")
          .updateOne(atomicFilter, senderDebit);
        if (senderUpdate.modifiedCount === 0) {
          throw new Error("INSUFFICIENT_FUNDS");
        }

        try {
          const targetUpdate = await db
            .collection<Character>("characters")
            .updateOne({ _id: targetObjectId }, targetCredit);
          if (targetUpdate.matchedCount === 0) {
            await db
              .collection<Character>("characters")
              .updateOne(
                { _id: sender._id },
                { $inc: { [campaignFundsField]: transferAmountLocal } }
              );
            throw new Error("TARGET_NOT_FOUND");
          }
        } catch (error) {
          if ((error as Error).message !== "TARGET_NOT_FOUND") {
            await db
              .collection<Character>("characters")
              .updateOne(
                { _id: sender._id },
                { $inc: { [campaignFundsField]: transferAmountLocal } }
              );
          }
          throw error;
        }
      }
    );

    try {
      const { awardAchievement, resolveUserIdFromCharacter } = await import("@/lib/achievements");
      const { checkFundsAchievements } = await import("@/lib/achievements/triggers");
      const senderUserId = new ObjectId(user.userId);
      await awardAchievement(senderUserId, "donor", sender._id);
      // Target character's userId must be resolved from the character doc
      const targetUserId = await resolveUserIdFromCharacter(targetObjectId);
      if (targetUserId) {
        await awardAchievement(targetUserId, "big_spender", targetObjectId);
      }
      // Achievement system uses anchor units. Derive from the in-memory sender
      // (pre-debit) by subtracting the transfer; convert to anchor at the
      // boundary so the helper stays unit-explicit.
      const newSenderBalanceLocal =
        localCampaignBalance(sender, forexEnabled) - transferAmountLocal;
      const newSenderBalanceAnchor = forexEnabled
        ? newSenderBalanceLocal / homeFxRate
        : newSenderBalanceLocal;
      await checkFundsAchievements(senderUserId, sender._id, newSenderBalanceAnchor);
    } catch (e) {
      console.error("Achievement check failed:", e);
    }

    const turn = gameTime.currentTurn;
    const now = new Date();
    const currency = senderCurrency;

    // Both legs use `campaign_donation` (matches the `party_transfer` two-leg
    // pattern: same type, opposite signs). Pre-fix this emitted the legacy
    // mixed-source fund_debit/fund_credit pair, which made campaign donations
    // indistinguishable from office_income / fundraise_credit in the ledger.
    void emitTx(db, {
      type: "campaign_donation",
      turn,
      createdAt: now,
      subjectType: "character",
      subjectId: sender._id,
      subjectName: sender.name,
      amount: -transferAmount,
      currencyCode: currency,
      counterpartyType: "character",
      counterpartyId: target._id,
      counterpartyName: target.name,
      meta: { side: "donor" },
    });
    void emitTx(db, {
      type: "campaign_donation",
      turn,
      createdAt: now,
      subjectType: "character",
      subjectId: target._id,
      subjectName: target.name,
      amount: transferAmount,
      currencyCode: currency,
      counterpartyType: "character",
      counterpartyId: sender._id,
      counterpartyName: sender.name,
      meta: { side: "recipient" },
    });

    // Response is in the sender's local home currency, matching the `amount` input.
    const senderRemainingFunds = localCampaignBalance(sender, forexEnabled) - transferAmountLocal;
    return NextResponse.json({
      success: true,
      amount: transferAmount,
      currency: senderCurrency,
      senderRemainingFunds,
      targetName: target.name,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_FUNDS") {
      return NextResponse.json({ error: "Insufficient funds" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "TARGET_NOT_FOUND") {
      return NextResponse.json({ error: "Target character not found" }, { status: 404 });
    }
    return handleRouteError(error);
  }
}
