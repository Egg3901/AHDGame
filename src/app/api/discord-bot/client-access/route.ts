import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { Character, User } from "@/lib/db/types";

export const DEFAULT_TEMP_SP_ACCESS_DAYS = 30;
export const MAX_TEMP_SP_ACCESS_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const schema = z.object({
  discordId: z.string().min(1),
  days: z.number().int().min(1).max(MAX_TEMP_SP_ACCESS_DAYS).optional(),
  grantedBy: z.string().min(1).max(80).optional(),
});

function requestedExpiry(days: number, now: Date): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

// POST /api/discord-bot/client-access — Grant time-limited singleplayer access.
// Body: { discordId: string, days?: number, grantedBy?: string }
// Auth: requireBotToken (private key only)
export async function POST(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:client-access-write",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { discordId, grantedBy } = parsed.data;
    const days = parsed.data.days ?? DEFAULT_TEMP_SP_ACCESS_DAYS;

    const db = await getDb();
    const user = await db.collection<User>("users").findOne({ discordId });
    if (!user) {
      return NextResponse.json(
        {
          found: false,
          message: "No linked game account for that Discord user.",
        },
        { status: 404 }
      );
    }

    const character = await db.collection<Character>("characters").findOne({ userId: user._id });

    if (user.singleplayerEntitledAt) {
      return NextResponse.json({
        found: true,
        alreadyPermanent: true,
        extended: false,
        username: user.username,
        characterName: character?.name ?? null,
        discordId: user.discordId ?? discordId,
        discordUsername: user.discordUsername ?? null,
        expiresAt: null,
        days,
      });
    }

    const now = new Date();
    const requested = requestedExpiry(days, now);
    const current = user.clientAccessExpiresAt ? new Date(user.clientAccessExpiresAt) : null;
    const keepCurrent = current != null && current.getTime() >= requested.getTime();
    const expiresAt = keepCurrent ? current : requested;

    if (!keepCurrent) {
      await db.collection<User>("users").updateOne(
        { _id: user._id },
        {
          $set: {
            clientAccessExpiresAt: expiresAt,
            clientAccessSource: "bot",
            clientAccessGrantedBy: grantedBy ?? "Discord Bot",
            updatedAt: now,
          },
        }
      );

      await createAdminLog({
        category: "account",
        action: "client_access_granted",
        username: user.username,
        characterName: character?.name,
        adminUsername: grantedBy ?? "Discord Bot",
        details: `Granted ${days}-day singleplayer access via /temp-sp-access.`,
      });
    }

    return NextResponse.json({
      found: true,
      alreadyPermanent: false,
      extended: !keepCurrent,
      username: user.username,
      characterName: character?.name ?? null,
      discordId: user.discordId ?? discordId,
      discordUsername: user.discordUsername ?? null,
      expiresAt: expiresAt.toISOString(),
      days,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
