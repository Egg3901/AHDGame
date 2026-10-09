import type { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { BOT_CASINO_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

/** Bot-token auth plus a ceiling across every player. Run before reading the body. */
export function guardCasinoRequest(request: Request): NextResponse | null {
  if (!requireBotToken(request, false)) return errorResponse(401, "Unauthorized");
  const global = checkRateLimit(
    "discord-bot:casino",
    BOT_CASINO_LIMITS.globalMaxRequests,
    BOT_CASINO_LIMITS.windowMs
  );
  return global.ok ? null : rateLimitResponse(global.retryAfter);
}

/** Per-player rate limit, once the body names the player. */
export function guardCasinoPlayer(discordId: string): NextResponse | null {
  const limit = checkRateLimit(
    `discord-bot:casino:${discordId}`,
    BOT_CASINO_LIMITS.maxRequests,
    BOT_CASINO_LIMITS.windowMs
  );
  return limit.ok ? null : rateLimitResponse(limit.retryAfter);
}

export function casinoFailure(result: {
  status: number;
  error: string;
  extra?: Record<string, unknown>;
}): NextResponse {
  return errorResponse(result.status, result.error, { extra: result.extra });
}
