import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { errorResponse, handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import { loadHouse } from "@/lib/casino/house";

// GET /api/discord-bot/blackjack/fund — The casino house bank that blackjack and every other
// house game pays from. `balance` is the anchor-unit bank; legacy totals are kept for history.
// Auth: X-Bot-Token. Errors: 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return errorResponse(401, "Unauthorized");
    }

    const rateLimit = checkRateLimit(
      "discord-bot:blackjack-fund",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const house = await loadHouse(await getDb());
    const blackjack = house.games?.blackjack;
    return NextResponse.json({
      found: true,
      balance: Math.floor(house.anchorBalance),
      currency: "anchor",
      totalWagered: house.totalWagered ?? 0,
      totalPaidOut: house.totalPaidOut ?? 0,
      totalCollected: house.totalCollected ?? 0,
      gamesPlayed: (house.gamesPlayed ?? 0) + (blackjack?.played ?? 0),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
