import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_BLACKJACK_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import type { Character, User } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getTotalPersonalWealth, getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";

const placeWagerSchema = z.object({
  discordId: z.string().min(1, "discordId is required"),
  wagerAmount: z.number().positive("wagerAmount must be a positive number"),
  gameId: z.string().optional(),
});

// POST /api/discord-bot/blackjack/place-wager — Places a wager by deducting from player's LC.
// This should be called when the game starts, before the result is known.
// Auth: requireAdminOrApiKey (via X-Bot-Token header)
// Errors: 400 (invalid request), 401 (unauthorized), 404 (user/character not found), 402 (insufficient funds)
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:blackjack-place-wager",
      BOT_BLACKJACK_LIMITS.maxRequests,
      BOT_BLACKJACK_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, placeWagerSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { discordId, wagerAmount: rawWagerAmount, gameId: bodyGameId } = parsed.data;

    const wagerAmount = Math.floor(rawWagerAmount);
    const gameId = bodyGameId || new ObjectId().toString();

    const db = await getDb();

    // Look up user by Discord ID
    const user = await db.collection<User>("users").findOne({ discordId });
    if (!user) {
      return NextResponse.json(
        { error: "No user found with that Discord ID", discordId },
        { status: 404 }
      );
    }

    // Look up character by user ID
    const character = await db.collection<Character>("characters").findOne({ userId: user._id });

    if (!character) {
      return NextResponse.json(
        { error: "User has no character. Create a character first.", discordId },
        { status: 404 }
      );
    }

    // Check if user is banned
    if (user.isBanned) {
      return NextResponse.json({ error: "This account is banned", discordId }, { status: 403 });
    }

    // Check liquid capital
    const forexEnabled = await isForexEnabled();
    const homeCurrency = getHomeCurrency(character);

    // Atomic balance-gated wager debit. Pre-fix path read currentCash with
    // getTotalPersonalWealth and ran a separate naïve $inc — race-prone.
    const debitResult = await atomicallyDebitCharacterCash(
      db,
      character._id,
      homeCurrency,
      wagerAmount,
      forexEnabled
    );
    if (!debitResult.ok) {
      const currentCash = getTotalPersonalWealth(character, forexEnabled);
      return NextResponse.json(
        {
          error: "Insufficient funds",
          message: `You need ${wagerAmount.toLocaleString()} to wager, but you only have ${Math.floor(currentCash).toLocaleString()} in liquid capital.`,
          currentCash,
          requiredAmount: wagerAmount,
          shortAmount: wagerAmount - currentCash,
        },
        { status: 402 }
      );
    }

    const now = new Date();

    // Store pending wager in a separate collection for tracking. If the insert
    // fails after the debit, refund the wager immediately so cash cannot be lost.
    try {
      await db.collection("blackjackPendingWagers").insertOne({
        gameId,
        discordId,
        characterId: character._id,
        wagerAmount,
        currency: homeCurrency,
        placedAt: now,
        status: "pending",
      });
    } catch (error) {
      await refundCharacterCash(db, character._id, homeCurrency, wagerAmount, forexEnabled);
      throw error;
    }

    // Cache pre-debit value for the response. The atomic primitive
    // returned newBalance for the home-currency wallet, but the caller
    // expects total liquid wealth for the response — re-derive from the
    // pre-debit snapshot since the credited side is unchanged.
    const previousCash = getTotalPersonalWealth(character, forexEnabled);
    const newCash = previousCash - wagerAmount;

    return NextResponse.json({
      success: true,
      gameId,
      discordId,
      characterId: character._id.toString(),
      characterName: character.name,
      countryId: character.countryId,
      currency: homeCurrency,
      wagerAmount,
      previousCash,
      newCash,
      message: `Wager of ${wagerAmount.toLocaleString()} ${homeCurrency} placed. Good luck!`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
