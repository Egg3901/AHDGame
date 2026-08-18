import { describe, expect, it } from "vitest";
import {
  DISCORD_EPOCH_MS,
  discordCreatedAtFromSnowflake,
  discordProfileUrl,
  formatDiscordAccountAge,
  toAbsoluteUploadUrl,
} from "./discord";

const BASE = "https://ahousedividedgame.com";

describe("toAbsoluteUploadUrl", () => {
  it("returns null for empty/missing values", () => {
    expect(toAbsoluteUploadUrl(null, BASE)).toBeNull();
    expect(toAbsoluteUploadUrl(undefined, BASE)).toBeNull();
    expect(toAbsoluteUploadUrl("", BASE)).toBeNull();
  });

  it("prefixes a root-relative upload path with the base URL", () => {
    expect(toAbsoluteUploadUrl("/api/uploads/avatars/abc.webp", BASE)).toBe(
      "https://ahousedividedgame.com/api/uploads/avatars/abc.webp"
    );
  });

  it("prefixes a bare filename (no leading slash) with a single separator", () => {
    expect(toAbsoluteUploadUrl("avatar.png", BASE)).toBe(
      "https://ahousedividedgame.com/avatar.png"
    );
  });

  it("passes through already-absolute http(s) URLs unchanged", () => {
    expect(toAbsoluteUploadUrl("https://cdn.example.com/a.png", BASE)).toBe(
      "https://cdn.example.com/a.png"
    );
    expect(toAbsoluteUploadUrl("http://cdn.example.com/a.png", BASE)).toBe(
      "http://cdn.example.com/a.png"
    );
  });

  it("does not produce a double slash when the base has a trailing slash", () => {
    expect(toAbsoluteUploadUrl("/api/uploads/avatars/abc.webp", `${BASE}/`)).toBe(
      "https://ahousedividedgame.com/api/uploads/avatars/abc.webp"
    );
  });

  it("yields a URL that the WHATWG URL parser accepts (Discord-embeddable)", () => {
    const out = toAbsoluteUploadUrl("/api/uploads/avatars/abc.webp", BASE);
    expect(() => new URL(out!)).not.toThrow();
  });
});

describe("discordCreatedAtFromSnowflake", () => {
  it("decodes Discord's documented example snowflake", () => {
    // https://discord.com/developers/docs/reference#snowflakes
    const created = discordCreatedAtFromSnowflake("175928847299117063");
    expect(created?.toISOString()).toBe("2016-04-30T11:18:25.796Z");
  });

  it("returns the epoch for snowflake 0", () => {
    expect(discordCreatedAtFromSnowflake("0")?.getTime()).toBe(DISCORD_EPOCH_MS);
  });

  it("returns null for unparseable ids", () => {
    expect(discordCreatedAtFromSnowflake("")).toBeNull();
    expect(discordCreatedAtFromSnowflake("not-a-snowflake")).toBeNull();
  });
});

describe("discordProfileUrl", () => {
  it("points at the public Discord user profile", () => {
    expect(discordProfileUrl("175928847299117063")).toBe(
      "https://discord.com/users/175928847299117063"
    );
  });
});

describe("formatDiscordAccountAge", () => {
  const now = new Date("2026-08-18T00:00:00.000Z");

  it("formats years and leftover months", () => {
    expect(formatDiscordAccountAge(new Date("2016-04-30T00:00:00.000Z"), now)).toBe("10y 3mo old");
  });

  it("formats days for young accounts", () => {
    expect(formatDiscordAccountAge(new Date("2026-08-07T00:00:00.000Z"), now)).toBe("11d old");
  });
});
