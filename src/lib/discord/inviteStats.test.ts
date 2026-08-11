import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("fetchDiscordInviteStats", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses member and online counts from the Discord invite API", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          guild: { name: "A House Divided - Online Political Sim/RPG" },
          approximate_member_count: 299,
          approximate_presence_count: 49,
        }),
        { status: 200 }
      )
    );

    const { fetchDiscordInviteStats } = await import("@/lib/discord/inviteStats");
    const stats = await fetchDiscordInviteStats({ forceRefresh: true });

    expect(stats).toEqual({
      guildName: "A House Divided - Online Political Sim/RPG",
      memberCount: 299,
      onlineCount: 49,
    });
  });

  it("returns null when the invite payload is missing counts", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ guild: { name: "Test Guild" } }), { status: 200 })
    );

    const { fetchDiscordInviteStats } = await import("@/lib/discord/inviteStats");
    const stats = await fetchDiscordInviteStats({ forceRefresh: true });

    expect(stats).toBeNull();
  });
});
