import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDisplay = vi.hoisted(() => ({
  value: undefined as { characterName: string | null; avatarUrl: string | null } | undefined,
}));
vi.mock("@/lib/suggestions/reporterDisplay", () => ({
  loadReporterDisplayMap: async (_db: unknown, ids: ObjectId[]) =>
    new Map(mockDisplay.value ? [[ids[0]!.toString(), mockDisplay.value]] : []),
}));

import { resolveSuggestionReporterIdentity } from "./reporterIdentity";

const BASE = "https://ahousedividedgame.com";
let mockUser: Record<string, unknown> | null = null;
const db = {
  collection: () => ({ findOne: async () => mockUser }),
} as unknown as Db;
const userId = new ObjectId();

describe("resolveSuggestionReporterIdentity", () => {
  beforeEach(() => {
    mockUser = null;
    mockDisplay.value = undefined;
  });

  it("linked account: in-game name with the Discord avatar", async () => {
    mockUser = { username: "player", discordId: "123456789012345678", discordAvatar: "abc" };
    mockDisplay.value = { characterName: "Jane Smith", avatarUrl: "/api/uploads/avatars/j.webp" };
    expect(await resolveSuggestionReporterIdentity(db, { userId }, BASE)).toEqual({
      name: "Jane Smith",
      iconUrl: "https://cdn.discordapp.com/avatars/123456789012345678/abc.png",
    });
  });

  it("game account without Discord: in-game name and absolute in-game avatar", async () => {
    mockUser = { username: "player" };
    mockDisplay.value = { characterName: "Jane Smith", avatarUrl: "/api/uploads/avatars/j.webp" };
    expect(await resolveSuggestionReporterIdentity(db, { userId }, BASE)).toEqual({
      name: "Jane Smith",
      iconUrl: `${BASE}/api/uploads/avatars/j.webp`,
    });
  });

  it("falls back to the username when the player has no character", async () => {
    mockUser = { username: "player" };
    expect(await resolveSuggestionReporterIdentity(db, { userId }, BASE)).toEqual({
      name: "player",
      iconUrl: undefined,
    });
  });

  it("Discord-only submitter: Discord name and the avatar the bot sent", async () => {
    expect(
      await resolveSuggestionReporterIdentity(
        db,
        {
          userId: null,
          discordSubmitUserId: "123456789012345678",
          discordSubmitDisplayName: "Discord Person",
          discordSubmitAvatarUrl: "https://cdn.discordapp.com/avatars/123456789012345678/x.png",
        },
        BASE
      )
    ).toEqual({
      name: "Discord Person",
      iconUrl: "https://cdn.discordapp.com/avatars/123456789012345678/x.png",
    });
  });

  it("Discord-only submitter without an avatar gets the Discord default avatar", async () => {
    const identity = await resolveSuggestionReporterIdentity(
      db,
      { userId: null, discordSubmitUserId: "123456789012345678", discordSubmitUsername: "dp" },
      BASE
    );
    expect(identity?.name).toBe("@dp");
    expect(identity?.iconUrl).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/\d\.png$/);
  });

  it("returns undefined for an anonymous web submission", async () => {
    expect(await resolveSuggestionReporterIdentity(db, { userId: null }, BASE)).toBeUndefined();
  });
});
