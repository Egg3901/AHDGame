import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { applyPatreonStatus } from "@/lib/patreon/service";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import type { Character, User } from "@/lib/db/types";

const schema = z
  .object({
    discordId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    tier: z.enum(["regular", "plus", "plus-plus"], {
      message: "tier must be 'regular', 'plus', or 'plus-plus'",
    }),
  })
  .refine((data) => !!data.discordId || !!data.name, {
    message: "Must provide discordId or name",
  });

// POST /api/discord-bot/supporter — Grant or update supporter status for a player.
// Body: { discordId?: string, name?: string, tier: "regular" | "plus" | "plus-plus" }
// Auth: requireBotToken (private key only)
// Errors: 400, 401, 404
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:supporter-write",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { discordId, name, tier } = parsed.data;

    const db = await getDb();

    // Resolve user
    let user: User | null = null;
    let character: Character | null = null;

    if (discordId) {
      user = await db.collection<User>("users").findOne({ discordId });
      if (user) {
        character = await db.collection<Character>("characters").findOne({ userId: user._id });
      }
    } else if (name) {
      character = await db
        .collection<Character>("characters")
        .findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } });
      if (character) {
        user = await db.collection<User>("users").findOne({ _id: character.userId });
      }
    }

    if (!user) {
      return NextResponse.json(
        {
          found: false,
          message: discordId
            ? `No linked account found for Discord user ${discordId}.`
            : `No character found matching "${name}".`,
        },
        { status: 404 }
      );
    }

    if (!character) {
      return NextResponse.json(
        {
          found: false,
          message: `User found but has no character.`,
        },
        { status: 404 }
      );
    }

    // Map bot tier names to internal PatreonTier values
    const patreonTier =
      tier === "plus-plus"
        ? "supporter-plus-plus"
        : tier === "plus"
          ? "supporter-plus"
          : "supporter";

    await applyPatreonStatus(db, {
      userId: user._id,
      tier: patreonTier,
      expiresAt: null, // Bot-managed supporters don't expire
      adsDisabledDefault: true,
      provider: "bot",
    });

    await createAdminLog({
      category: "account",
      action: "patreon_status_set",
      username: user.username,
      characterName: character.name,
      adminUsername: "Discord Bot",
      details: `Set supporter tier to ${tier} via /supporter command.`,
    });

    return NextResponse.json({
      found: true,
      characterId: character._id.toString(),
      characterName: character.name,
      discordId: user.discordId ?? null,
      discordUsername: user.discordUsername ?? null,
      tier,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
