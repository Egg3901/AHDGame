import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import type { Character, User } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getTotalPersonalWealth } from "@/lib/currency/characterFunds";

// GET /api/discord-bot/blackjack/balance?discordId=xxx
// Returns the player's current liquid capital (cashOnHand) and character info.
// Auth: requireAdminOrApiKey (via X-Bot-Token header)
// Errors: 401 (unauthorized), 404 (user/character not found)
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return errorResponse(401, "Unauthorized");
    }

    const rateLimit = checkRateLimit(
      "discord-bot:blackjack-balance",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { searchParams } = new URL(request.url);
    const discordId = searchParams.get("discordId");

    if (!discordId) {
      return errorResponse(400, "discordId query parameter is required");
    }

    const db = await getDb();

    // Look up user by Discord ID
    const user = await db.collection<User>("users").findOne({ discordId });
    if (!user) {
      return errorResponse(404, "No user found with that Discord ID", { extra: { discordId } });
    }

    const [character, forexEnabled] = await Promise.all([
      db.collection<Character>("characters").findOne({ userId: user._id }),
      isForexEnabled(),
    ]);

    if (!character) {
      return errorResponse(404, "User has no character. Create a character first.", {
        extra: { discordId },
      });
    }

    return NextResponse.json({
      success: true,
      discordId,
      characterId: character._id.toString(),
      characterName: character.name,
      countryId: character.countryId,
      cashOnHand: getTotalPersonalWealth(character, forexEnabled),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
