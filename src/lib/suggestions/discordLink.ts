import { getDiscordSuggestionsWebhookUrl } from "@/lib/discordWebhooks";

interface WebhookChannel {
  guildId: string;
  channelId: string;
}

const CACHE_MS = 60 * 60_000;
let cached: { url: string; value: WebhookChannel | null; at: number } | null = null;

/**
 * Guild and channel the suggestions webhook posts into. Read from the webhook
 * itself (a token-authenticated GET that needs no bot), cached for an hour.
 */
async function suggestionsWebhookChannel(): Promise<WebhookChannel | null> {
  const url = await getDiscordSuggestionsWebhookUrl();
  if (!url) return null;
  if (cached && cached.url === url && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value: WebhookChannel | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = (await res.json()) as { guild_id?: string; channel_id?: string };
      if (data.guild_id && data.channel_id) {
        value = { guildId: data.guild_id, channelId: data.channel_id };
      }
    }
  } catch {
    /* link is optional */
  }
  cached = { url, value, at: Date.now() };
  return value;
}

/** Link to a suggestion's post in the Discord suggestions channel, when it was posted. */
export async function suggestionDiscordMessageUrl(
  messageId: string | undefined
): Promise<string | null> {
  if (!messageId || !/^\d+$/.test(messageId)) return null;
  const channel = await suggestionsWebhookChannel();
  if (!channel) return null;
  return `https://discord.com/channels/${channel.guildId}/${channel.channelId}/${messageId}`;
}

/** Test seam: forget the cached webhook channel. */
export function resetSuggestionDiscordLinkCache() {
  cached = null;
}
