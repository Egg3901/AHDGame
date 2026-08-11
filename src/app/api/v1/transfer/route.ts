import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { requireUserApiKey } from "@/lib/api/userApiAuth";
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
import type { Character } from "@/lib/db/types";

const apiTransferSchema = z.object({
  targetCharacterId: schemas.objectId,
  // `amount` is in the sender's local home currency (same unit as their balance).
  amount: z.coerce.number().int().min(1000, "Minimum transfer is 1,000"),
});

// POST /api/v1/transfer — Transfer campaign funds from the API key owner's active character
// to another character. Auth: X-API-Key with "private" scope.
// Mirrors all restrictions from the session-based /api/characters/[id]/transfer.
export async function POST(request: Request) {
  try {
    const apiAuth = await requireUserApiKey(request, "private");
    if (!apiAuth.ok) {
      const status =
        apiAuth.reason === "missing"
          ? 401
          : apiAuth.reason === "invalid"
            ? 401
            : apiAuth.reason === "insufficient_scope"
              ? 403
              : 401;
      return NextResponse.json(
        { error: `API key ${apiAuth.reason.replace("_", " ")}` },
        { status }
      );
    }

    const rateLimit = checkRateLimit(apiAuth.ownerUserId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, apiTransferSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { targetCharacterId: targetIdStr, amount: transferAmount } = parsed.data;
    const targetObjectId = new ObjectId(targetIdStr);

    const db = await getDb();
    const [transferGuard, forexEnabled] = await Promise.all([
      requirePlayerTransfersEnabled(db),
      isForexEnabled(),
    ]);
    if (transferGuard) return transferGuard;

    // Resolve the API key owner's active character
    const userDoc = await db
      .collection("users")
      .findOne({ _id: new ObjectId(apiAuth.ownerUserId) });
    if (!userDoc) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const characterQuery = userDoc.activeCharacterId
      ? { _id: userDoc.activeCharacterId, userId: new ObjectId(apiAuth.ownerUserId) }
      : { userId: new ObjectId(apiAuth.ownerUserId) };
    const sender = await db.collection<Character>("characters").findOne(characterQuery);
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
    // same-country (asserted below), so sender and recipient share a currency and
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

    // Achievement checks
    try {
      const { awardAchievement, resolveUserIdFromCharacter } = await import("@/lib/achievements");
      const { checkFundsAchievements } = await import("@/lib/achievements/triggers");
      const senderUserId = new ObjectId(apiAuth.ownerUserId);
      await awardAchievement(senderUserId, "donor", sender._id);
      const targetUserId = await resolveUserIdFromCharacter(targetObjectId);
      if (targetUserId) {
        await awardAchievement(targetUserId, "big_spender", targetObjectId);
      }
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
      meta: { side: "donor", source: "api" },
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
      meta: { side: "recipient", source: "api" },
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
