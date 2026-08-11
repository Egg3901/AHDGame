import { describe, expect, it } from "vitest";
import { isInNewCharacterCooldown, NEW_CHARACTER_COOLDOWN_MS } from "./newCharacterCooldown";

const HOUR = 60 * 60 * 1000;

describe("isInNewCharacterCooldown", () => {
  const now = new Date("2026-04-19T12:00:00Z");

  it("blocks when user was created <24h ago", () => {
    const result = isInNewCharacterCooldown({
      userCreatedAt: new Date(now.getTime() - 5 * HOUR),
      characterCreatedAt: new Date(now.getTime() - 30 * HOUR),
      now,
    });
    expect(result.blocked).toBe(true);
    expect(result.unblockAt.getTime()).toBe(now.getTime() - 5 * HOUR + NEW_CHARACTER_COOLDOWN_MS);
  });

  it("blocks when character was created <24h ago", () => {
    const result = isInNewCharacterCooldown({
      userCreatedAt: new Date(now.getTime() - 30 * HOUR),
      characterCreatedAt: new Date(now.getTime() - 5 * HOUR),
      now,
    });
    expect(result.blocked).toBe(true);
    expect(result.unblockAt.getTime()).toBe(now.getTime() - 5 * HOUR + NEW_CHARACTER_COOLDOWN_MS);
  });

  it("blocks when party was joined <24h ago", () => {
    const result = isInNewCharacterCooldown({
      userCreatedAt: new Date(now.getTime() - 30 * HOUR),
      characterCreatedAt: new Date(now.getTime() - 30 * HOUR),
      partyJoinedAt: new Date(now.getTime() - 5 * HOUR),
      now,
    });
    expect(result.blocked).toBe(true);
  });

  it("uses the most-recent anchor", () => {
    const result = isInNewCharacterCooldown({
      userCreatedAt: new Date(now.getTime() - 100 * HOUR),
      characterCreatedAt: new Date(now.getTime() - 50 * HOUR),
      partyJoinedAt: new Date(now.getTime() - 10 * HOUR),
      now,
    });
    expect(result.blocked).toBe(true);
    expect(result.unblockAt.getTime()).toBe(now.getTime() - 10 * HOUR + NEW_CHARACTER_COOLDOWN_MS);
  });

  it("allows when all anchors are past cooldown", () => {
    const result = isInNewCharacterCooldown({
      userCreatedAt: new Date(now.getTime() - 100 * HOUR),
      characterCreatedAt: new Date(now.getTime() - 50 * HOUR),
      partyJoinedAt: new Date(now.getTime() - 48 * HOUR),
      now,
    });
    expect(result.blocked).toBe(false);
  });

  it("treats missing partyJoinedAt as not an anchor", () => {
    const result = isInNewCharacterCooldown({
      userCreatedAt: new Date(now.getTime() - 100 * HOUR),
      characterCreatedAt: new Date(now.getTime() - 48 * HOUR),
      now,
    });
    expect(result.blocked).toBe(false);
  });

  it("treats null partyJoinedAt as not an anchor", () => {
    const result = isInNewCharacterCooldown({
      userCreatedAt: new Date(now.getTime() - 100 * HOUR),
      characterCreatedAt: new Date(now.getTime() - 48 * HOUR),
      partyJoinedAt: null,
      now,
    });
    expect(result.blocked).toBe(false);
  });

  it("ignores recent party joins when includePartyJoinedAt is false", () => {
    const result = isInNewCharacterCooldown({
      userCreatedAt: new Date(now.getTime() - 100 * HOUR),
      characterCreatedAt: new Date(now.getTime() - 50 * HOUR),
      partyJoinedAt: new Date(now.getTime() - 5 * HOUR),
      includePartyJoinedAt: false,
      now,
    });
    expect(result.blocked).toBe(false);
    expect(result.unblockAt.getTime()).toBe(now.getTime() - 50 * HOUR + NEW_CHARACTER_COOLDOWN_MS);
  });
});
