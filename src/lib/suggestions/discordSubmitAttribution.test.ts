import { describe, expect, it } from "vitest";
import { discordSubmitHandleForChip, discordSubmitPrimaryLabel } from "./discordSubmitAttribution";

describe("discordSubmitPrimaryLabel", () => {
  it("prefers display name", () => {
    expect(
      discordSubmitPrimaryLabel({
        discordSubmitDisplayName: "Alice",
        discordSubmitUsername: "alice123",
        discordSubmitUserId: "9",
      })
    ).toBe("Alice");
  });

  it("falls back to @username", () => {
    expect(
      discordSubmitPrimaryLabel({
        discordSubmitUsername: "bob",
        discordSubmitUserId: "9",
      })
    ).toBe("@bob");
  });

  it("falls back to truncated id", () => {
    expect(
      discordSubmitPrimaryLabel({
        discordSubmitUserId: "123456789012345678",
      })
    ).toBe("Discord (1234567890…)");
  });
});

describe("discordSubmitHandleForChip", () => {
  it("returns username without @", () => {
    expect(discordSubmitHandleForChip({ discordSubmitUsername: "carol" })).toBe("carol");
  });
});
