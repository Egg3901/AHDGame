import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import type { GameConfig } from "@/lib/db/types";

// GET /api/discord-bot/channel-config — Returns the Discord channel IDs for news and suggestions webhooks.
// Resolves channel IDs from the webhook URLs stored in gameConfig (set via the admin panel).
// Auth: requireBotToken
// Errors: 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne(
        { _id: "default" },
        { projection: { discordNewsWebhookUrl: 1, discordSuggestionsWebhookUrl: 1 } }
      );

    const newsChannelId = await resolveChannelId(config?.discordNewsWebhookUrl);
    const suggestionsChannelId = await resolveChannelId(config?.discordSuggestionsWebhookUrl);

    return NextResponse.json({ newsChannelId, suggestionsChannelId });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Extract channel_id from a Discord webhook URL by calling Discord's webhook info endpoint. */
async function resolveChannelId(webhookUrl: string | undefined): Promise<string | null> {
  if (!webhookUrl) return null;
  try {
    // Webhook URL format: https://discord.com/api/webhooks/{id}/{token}
    const match = webhookUrl.match(/\/webhooks\/(\d+)\/([^/?#]+)/);
    if (!match) return null;
    const [, id, token] = match;
    const res = await fetch(`https://discord.com/api/webhooks/${id}/${token}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { channel_id?: string };
    return data.channel_id ?? null;
  } catch {
    return null;
  }
}
