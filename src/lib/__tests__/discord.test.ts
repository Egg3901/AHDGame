import { describe, it, expect } from "vitest";
import { getDiscordAvatarUrl, getDiscordOAuthUrl, DISCORD_OAUTH_SCOPES } from "../discord";

describe("Discord utilities", () => {
  describe("getDiscordAvatarUrl", () => {
    it("returns CDN URL when avatar hash exists", () => {
      const url = getDiscordAvatarUrl("123456789", "abc123hash");
      expect(url).toBe("https://cdn.discordapp.com/avatars/123456789/abc123hash.png");
    });

    it("returns default avatar URL when avatar hash is null", () => {
      const url = getDiscordAvatarUrl("123456789", null);
      expect(url).toBe("https://cdn.discordapp.com/embed/avatars/4.png");
    });

    it("calculates default avatar index from user ID", () => {
      const url = getDiscordAvatarUrl("123456783", null);
      expect(url).toBe("https://cdn.discordapp.com/embed/avatars/3.png");
    });
  });

  describe("getDiscordOAuthUrl", () => {
    it("generates correct OAuth URL with state", () => {
      const url = getDiscordOAuthUrl("test-state", "https://example.com/callback", "client123");
      expect(url).toContain("https://discord.com/oauth2/authorize");
      expect(url).toContain("client_id=client123");
      expect(url).toContain("state=test-state");
      expect(url).toContain("scope=identify");
      expect(url).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fcallback");
    });
  });

  describe("DISCORD_OAUTH_SCOPES", () => {
    it("exports the correct scope value", () => {
      expect(DISCORD_OAUTH_SCOPES).toBe("identify");
    });
  });
});
