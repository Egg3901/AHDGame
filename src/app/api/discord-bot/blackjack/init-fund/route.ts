import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { DiscordBotFund } from "@/lib/db/types/discordBotFund";

// POST /api/discord-bot/blackjack/init-fund — Initializes the blackjack prize pool with $200M.
// This is a one-time setup endpoint. Should only be called by admins.
// Auth: requireAdminOrApiKey (via X-Bot-Token header)
// Errors: 401 (unauthorized), 409 (already initialized)
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit("discord-bot:blackjack-init-fund", 5, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();

    // Check if fund already exists
    const existingFund = await db
      .collection<DiscordBotFund>("discordBotFunds")
      .findOne({ name: "blackjack_prize_pool" });

    if (existingFund) {
      return NextResponse.json(
        {
          error: "Already initialized",
          message: "The blackjack prize pool is already set up.",
          currentBalance: existingFund.balance,
          createdAt: existingFund.createdAt,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const INITIAL_BALANCE = 200_000_000; // $200 million USD equivalent

    const result = await db.collection<DiscordBotFund>("discordBotFunds").insertOne({
      _id: new ObjectId(),
      name: "blackjack_prize_pool",
      balance: INITIAL_BALANCE,
      // Initialize per-currency balances for forex support
      currencyBalances: {
        USD: INITIAL_BALANCE,
        GBP: 0,
        JPY: 0,
        EUR: 0,
      },
      totalWagered: 0,
      totalPaidOut: 0,
      totalCollected: 0,
      gamesPlayed: 0,
      createdAt: now,
      updatedAt: now,
    });

    if (!result.acknowledged) {
      return NextResponse.json(
        { error: "Failed to initialize prize pool", insertedId: result.insertedId },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Blackjack prize pool initialized successfully",
      initialBalance: INITIAL_BALANCE,
      fundId: result.insertedId.toString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
