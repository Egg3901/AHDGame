import { beforeEach, describe, expect, it, vi } from "vitest";

const webhookUrl = vi.hoisted(() => ({
  value: "https://discord.com/api/webhooks/1/tok" as string | undefined,
}));
vi.mock("@/lib/discordWebhooks", () => ({
  getDiscordSuggestionsWebhookUrl: async () => webhookUrl.value,
}));

import { resetSuggestionDiscordLinkCache, suggestionDiscordMessageUrl } from "./discordLink";

describe("suggestionDiscordMessageUrl", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    resetSuggestionDiscordLinkCache();
    webhookUrl.value = "https://discord.com/api/webhooks/1/tok";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ guild_id: "10", channel_id: "20" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("builds the message link from the webhook's guild and channel, cached", async () => {
    expect(await suggestionDiscordMessageUrl("30")).toBe("https://discord.com/channels/10/20/30");
    expect(await suggestionDiscordMessageUrl("31")).toBe("https://discord.com/channels/10/20/31");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null without a message id, a webhook, or a readable webhook", async () => {
    expect(await suggestionDiscordMessageUrl(undefined)).toBeNull();
    expect(await suggestionDiscordMessageUrl("not-a-snowflake")).toBeNull();
    webhookUrl.value = undefined;
    expect(await suggestionDiscordMessageUrl("30")).toBeNull();
    webhookUrl.value = "https://discord.com/api/webhooks/1/tok";
    fetchMock.mockResolvedValueOnce({ ok: false });
    expect(await suggestionDiscordMessageUrl("30")).toBeNull();
  });
});
