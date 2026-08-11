import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import { isPatreonActive } from "@/lib/db/types/patreon";
import type { User } from "@/lib/db/types";

// GET /api/discord-bot/supporters — Bulk feed for the Discord supporter-role sync.
// Returns every active-supporter Discord user (with tier) plus the full set of
// Discord IDs linked to an AHD account, so the bot can distinguish a lapsed
// supporter (known account) from an unmanaged manual Discord grant (no account).
// Auth: requireBotToken (private key only). Read-only, no writes.
// Errors: 401, 429
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request, false)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:supporters-get",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();

    // Every user with a linked Discord account. Projection only pulls the
    // fields the sync needs — no PII beyond the Discord ID + supporter status.
    const linkedUsers = await db
      .collection<User>("users")
      .find({ discordId: { $exists: true, $ne: "" } })
      .project<{
        discordId: string;
        patreonTier?: User["patreonTier"];
        patreonExpiresAt?: Date | null;
      }>({
        discordId: 1,
        patreonTier: 1,
        patreonExpiresAt: 1,
      })
      .toArray();

    const linkedDiscordIds: string[] = [];
    const supporters: {
      discordId: string;
      tier: "supporter" | "supporter-plus" | "supporter-plus-plus";
    }[] = [];

    for (const u of linkedUsers) {
      if (!u.discordId) continue;
      linkedDiscordIds.push(u.discordId);

      const tier = u.patreonTier ?? null;
      if (tier && isPatreonActive(tier, u.patreonExpiresAt)) {
        supporters.push({ discordId: u.discordId, tier });
      }
    }

    return NextResponse.json({ supporters, linkedDiscordIds });
  } catch (error) {
    return handleRouteError(error);
  }
}
