import { describe, expect, it } from "vitest";
import { leaderboardDisplayCharacterId } from "./leaderboardIdentity";
const lives = [
  { characterId: "old", isActive: false, retiredAtMs: 100 },
  { characterId: "latest", isActive: false, retiredAtMs: 200 },
  { characterId: "current", isActive: true, retiredAtMs: null },
];
describe("leaderboard identity", () => {
  it("defaults to the current identity rather than changing with the scoring career", () => {
    expect(leaderboardDisplayCharacterId(lives, null)).toBe("current");
    expect(leaderboardDisplayCharacterId(lives, "current")).toBe("current");
  });
  it("honors a recorded life belonging to the account, with a safe fallback", () => {
    expect(leaderboardDisplayCharacterId(lives, "old")).toBe("old");
    expect(leaderboardDisplayCharacterId(lives, "another-account")).toBe("current");
  });
  it("uses the most recent retired life when no current character remains", () => {
    expect(leaderboardDisplayCharacterId(lives.slice(0, 2), null)).toBe("latest");
    expect(leaderboardDisplayCharacterId([], null)).toBeNull();
  });
  it("uses the account's selected live character and ignores stale pointers", () => {
    const multiple = [...lives, { characterId: "newer", isActive: true, retiredAtMs: null }];
    expect(leaderboardDisplayCharacterId(multiple, null, "current")).toBe("current");
    expect(leaderboardDisplayCharacterId(multiple, "old", "current")).toBe("old");
    expect(leaderboardDisplayCharacterId(lives, "current", "old")).toBe("current");
  });
});
