import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      return NextResponse.json({ error: "discordId query parameter is required" }, { status: 400 });
    }

    const db = await getDb();

    // Look up user by Discord ID
    const user = await db.collection<User>("users").findOne({ discordId });
    if (!user) {
      return NextResponse.json(
        { error: "No user found with that Discord ID", discordId },
        { status: 404 }
      );
    }

    const [character, forexEnabled] = await Promise.all([
      db.collection<Character>("characters").findOne({ userId: user._id }),
      isForexEnabled(),
    ]);

    if (!character) {
      return NextResponse.json(
        { error: "User has no character. Create a character first.", discordId },
        { status: 404 }
      );
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
