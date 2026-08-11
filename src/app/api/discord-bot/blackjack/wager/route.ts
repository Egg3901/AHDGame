import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_BLACKJACK_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import type { DiscordBotFund } from "@/lib/db/types/discordBotFund";
import type { Character, User } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  getTotalPersonalWealth,
  buildPersonalBalanceInc,
  getHomeCurrency,
} from "@/lib/currency/characterFunds";

const wagerSchema = z.object({
  discordId: z.string().min(1, "discordId is required"),
  wagerAmount: z.number().positive("wagerAmount must be a positive number"),
  result: z.enum(["win", "loss"]),
  payoutMultiplier: z.number().positive().optional(),
});

/**
 * @deprecated Use POST /api/discord-bot/blackjack/place-wager to start a game,
 * then POST /api/discord-bot/blackjack/resolve to finish.
 *
 * This endpoint has a flaw: it doesn't deduct the wager when the game starts,
 * allowing players to spend the wagered money elsewhere during the game.
 *
 * POST /api/discord-bot/blackjack/wager — Records a completed blackjack game result.
 * Updates the player's liquid capital and the prize pool based on win/loss.
 * Auth: requireAdminOrApiKey (via X-Bot-Token header)
 * Errors: 400 (invalid request), 401 (unauthorized), 404 (user/character not found), 402 (insufficient funds)
 */
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:blackjack-wager",
      BOT_BLACKJACK_LIMITS.maxRequests,
      BOT_BLACKJACK_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, wagerSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { discordId, wagerAmount: rawWagerAmount, result, payoutMultiplier = 1.0 } = parsed.data;

    const wagerAmount = Math.floor(rawWagerAmount);

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
    const currentCash = getTotalPersonalWealth(character, forexEnabled);

    if (currentCash < wagerAmount) {
      return NextResponse.json(
        {
          error: "Insufficient funds",
          message: `You need ${wagerAmount.toLocaleString()} to wager, but you only have ${currentCash.toLocaleString()} in liquid capital.`,
          currentCash,
          requiredAmount: wagerAmount,
          shortAmount: wagerAmount - currentCash,
        },
        { status: 402 }
      );
    }

    // Get or create the prize pool fund
    const fund = await db
      .collection<DiscordBotFund>("discordBotFunds")
      .findOne({ name: "blackjack_prize_pool" });

    if (!fund) {
      return NextResponse.json(
        {
          error: "Prize pool not initialized",
          message: "The blackjack prize pool has not been set up yet. Contact an admin.",
        },
        { status: 503 }
      );
    }

    // House edge applied server-side — see resolve route for canonical implementation.
    const HOUSE_EDGE = Math.min(
      Math.max(parseFloat(process.env.BLACKJACK_HOUSE_EDGE ?? "0.05"), 0),
      1
    );

    // Calculate the outcome
    let cashChange: number;
    let poolChange: number;

    if (result === "win") {
      // Player wins: payout reduced by house edge
      const grossPayout = Math.floor(wagerAmount * payoutMultiplier);
      const payout = Math.floor(grossPayout * (1 - HOUSE_EDGE));
      cashChange = payout;
      poolChange = -payout;

      // Safety check: ensure pool has enough funds
      if (fund.balance + poolChange < 0) {
        return NextResponse.json(
          {
            error: "Prize pool insufficient",
            message: "The prize pool doesn't have enough funds for this payout. Contact an admin.",
            poolBalance: fund.balance,
            requiredPayout: payout,
          },
          { status: 503 }
        );
      }
    } else {
      // Player loses: wager goes into prize pool
      cashChange = -wagerAmount;
      poolChange = wagerAmount;
    }

    // Update character's cashOnHand and fund balance atomically
    const now = new Date();
    const updateResults = await Promise.all([
      // Update character
      db.collection<Character>("characters").updateOne(
        { _id: character._id },
        {
          $inc: buildPersonalBalanceInc(cashChange, homeCurrency, forexEnabled),
          $set: { updatedAt: now },
        }
      ),
      // Update fund
      db.collection<DiscordBotFund>("discordBotFunds").updateOne(
        { name: "blackjack_prize_pool" },
        {
          $inc: {
            balance: poolChange,
            totalWagered: wagerAmount,
            ...(result === "win"
              ? { totalPaidOut: Math.floor(wagerAmount * payoutMultiplier) }
              : { totalCollected: wagerAmount }),
            gamesPlayed: 1,
          },
          $set: { updatedAt: now },
        }
      ),
    ]);

    // Verify updates succeeded
    if (updateResults[0].matchedCount === 0) {
      return NextResponse.json(
        { error: "Failed to update character funds", discordId },
        { status: 500 }
      );
    }

    if (updateResults[1].matchedCount === 0) {
      return NextResponse.json(
        { error: "Failed to update prize pool", discordId },
        { status: 500 }
      );
    }

    const newCash = currentCash + cashChange;
    const newPoolBalance = fund.balance + poolChange;

    return NextResponse.json({
      success: true,
      discordId,
      characterId: character._id.toString(),
      characterName: character.name,
      countryId: character.countryId,
      wagerAmount,
      result,
      payoutMultiplier: result === "win" ? payoutMultiplier : undefined,
      payout: result === "win" ? Math.floor(wagerAmount * payoutMultiplier) : undefined,
      previousCash: currentCash,
      newCash,
      previousPoolBalance: fund.balance,
      newPoolBalance,
      gamesPlayed: (fund.gamesPlayed ?? 0) + 1,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
