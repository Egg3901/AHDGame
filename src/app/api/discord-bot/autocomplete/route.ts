import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { getEnabledCountryIdsFromDb } from "@/lib/countryAccess";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import type { Character, State, GameState } from "@/lib/db/types";
import { filterCountryResults } from "./countryResults";

// GET /api/discord-bot/autocomplete — Returns name/ID matches for Discord slash command option prefills. Supports type=characters, type=states, and type=countries.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:autocomplete",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const query = url.searchParams.get("q") ?? "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10", 10), 25);

    if (type !== "characters" && type !== "states" && type !== "countries") {
      return NextResponse.json(
        { error: "Unsupported type. Use type=characters, type=states, or type=countries" },
        { status: 400 }
      );
    }

    const db = await getDb();

    /*
     * Countries resolve before the empty-query guard below: an unfocused
     * country picker sends q="" and must still list every enabled country,
     * unlike characters/states which are far too numerous to enumerate.
     */
    if (type === "countries") {
      const [enabled, gameState] = await Promise.all([
        getEnabledCountryIdsFromDb(db),
        db.collection<GameState>("gameState").findOne({ _id: "current" }),
      ]);
      const preset = resolvePresetIdFromGameState(gameState);
      return NextResponse.json({ results: filterCountryResults(enabled, query, preset, limit) });
    }

    if (!query || query.length === 0) {
      return NextResponse.json({ results: [] });
    }

    if (type === "states") {
      const states = await db
        .collection<State>("states")
        .find(
          {
            $or: [
              { name: { $regex: escapeRegex(query), $options: "i" } },
              { _id: { $regex: escapeRegex(query), $options: "i" } },
            ],
          },
          { projection: { _id: 1, name: 1 } }
        )
        .limit(limit)
        .toArray();

      return NextResponse.json({
        results: states.map((s) => ({
          id: s._id,
          name: s.name,
        })),
      });
    }

    const characters = await db
      .collection<Character>("characters")
      .find(
        { name: { $regex: escapeRegex(query), $options: "i" } },
        { projection: { _id: 1, name: 1 } }
      )
      .limit(limit)
      .toArray();

    return NextResponse.json({
      results: characters.map((c) => ({
        id: c._id.toString(),
        name: c.name,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
