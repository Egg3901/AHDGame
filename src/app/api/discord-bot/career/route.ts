import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import type { Character, User } from "@/lib/db/types";

// GET /api/discord-bot/career — Returns a character's career history, looked up by characterId, discordId, or name.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:career",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const characterId = url.searchParams.get("characterId");
    const discordId = url.searchParams.get("discordId");
    const name = url.searchParams.get("name");

    if (!characterId && !discordId && !name) {
      return NextResponse.json(
        { error: "Must provide characterId, discordId, or name" },
        { status: 400 }
      );
    }

    const db = await getDb();

    let character: Character | null = null;

    if (characterId && ObjectId.isValid(characterId)) {
      character = await db
        .collection<Character>("characters")
        .findOne({ _id: new ObjectId(characterId) });
    } else if (discordId) {
      const user = await db.collection<User>("users").findOne({ discordId });
      if (user) {
        character = await db.collection<Character>("characters").findOne({ userId: user._id });
      }
    } else if (name) {
      character = await db
        .collection<Character>("characters")
        .findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } });
    }

    if (!character) {
      return NextResponse.json({ found: false, career: [] });
    }

    const career = (character.careerHistory ?? []).map((event) => ({
      type: event.type,
      office: event.officeLabel,
      officeRaw: event.office,
      party: event.party ?? null,
      electionId: event.electionId ?? null,
      date: event.date instanceof Date ? event.date.toISOString() : event.date,
    }));

    // Most recent first
    career.reverse();

    return NextResponse.json({
      found: true,
      characterId: character._id.toString(),
      characterName: character.name,
      career,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
