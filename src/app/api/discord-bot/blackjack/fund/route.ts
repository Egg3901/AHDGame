import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import type { DiscordBotFund } from "@/lib/db/types/discordBotFund";

// GET /api/discord-bot/blackjack/fund — Returns the current blackjack prize pool balance.
// Auth: requireAdminOrApiKey (via X-Bot-Token header)
// Errors: 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:blackjack-fund",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();

    const fund = await db
      .collection<DiscordBotFund>("discordBotFunds")
      .findOne({ name: "blackjack_prize_pool" });

    if (!fund) {
      return NextResponse.json({
        found: false,
        balance: 0,
        message: "Prize pool not initialized",
      });
    }

    return NextResponse.json({
      found: true,
      balance: fund.balance,
      currencyBalances: fund.currencyBalances ?? {
        USD: 0,
        GBP: 0,
        JPY: 0,
        EUR: 0,
      },
      totalWagered: fund.totalWagered ?? 0,
      totalPaidOut: fund.totalPaidOut ?? 0,
      totalCollected: fund.totalCollected ?? 0,
      gamesPlayed: fund.gamesPlayed ?? 0,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
