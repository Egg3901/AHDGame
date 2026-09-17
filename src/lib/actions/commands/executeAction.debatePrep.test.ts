/**
 * Debate Prep execute gate (Game1724): the shell rejects a disabled stat
 * system and a missing stat block with the shared quote reasons, and persists
 * a successful roll to `stats.debate` — all through quoteDebatePrepAction, so
 * the gate, the validation and the UI card read one source.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 1, preset: undefined }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/stats/featureFlag", () => ({
  isRpgStatsEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkActionAchievements: vi.fn().mockResolvedValue(undefined),
  checkFundsAchievements: vi.fn().mockResolvedValue(undefined),
}));

import { executeCharacterAction } from "./executeAction";
import { isRpgStatsEnabled } from "@/lib/stats/featureFlag";

const mockFlag = vi.mocked(isRpgStatsEnabled);

describe("executeCharacterAction — debate prep gate", () => {
  let findOneAndUpdate: ReturnType<typeof vi.fn>;

  function makeDb(character: Character): Db {
    findOneAndUpdate = vi.fn().mockResolvedValue({ ...character, actions: 99 });
    return {
      collection: vi.fn((name: string) => {
        if (name === "characters") {
          return { findOne: vi.fn().mockResolvedValue(character), findOneAndUpdate };
        }
        return {
          insertOne: vi.fn().mockResolvedValue({}),
          findOne: vi.fn().mockResolvedValue(null),
          find: () => ({ toArray: async () => [] }),
        };
      }),
    } as unknown as Db;
  }

  function makeCharacter(debate: number | null): Character {
    return {
      _id: new ObjectId(),
      name: "Studier",
      countryId: "US",
      homeState: "US-NY",
      party: "6",
      actions: 100,
      funds: 0,
      donorBaseLevel: 0,
      favorability: 0,
      infamy: 0,
      politicalInfluence: 0,
      ...(debate === null ? {} : { stats: { debate } }),
    } as unknown as Character;
  }

  function run(character: Character, rng: () => number) {
    return executeCharacterAction(makeDb(character), {
      character,
      characterQuery: { _id: character._id },
      actionType: "debatePrep",
      actor: { userId: null },
      rng,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFlag.mockResolvedValue(true);
  });

  it("rejects with the quote reason when the stat system is disabled", async () => {
    mockFlag.mockResolvedValue(false);
    const res = await run(makeCharacter(5), () => 0);
    expect(res).toEqual({
      ok: false,
      error: "The stat system is not currently enabled.",
      status: 400,
    });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects with the quote reason when no stat block is allocated", async () => {
    const res = await run(makeCharacter(null), () => 0);
    expect(res).toEqual({
      ok: false,
      error: "Allocate your stats before using Debate Prep.",
      status: 400,
    });
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("persists +1 Debate on a successful roll", async () => {
    const res = await run(makeCharacter(5), () => 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.message).toContain("Debate skill improved (+1)");
    const pipeline = findOneAndUpdate.mock.calls[0]![1] as [{ $set: Record<string, unknown> }];
    expect(pipeline[0].$set["stats.debate"]).toBe(6);
  });

  it("charges the AP without writing on a failed roll", async () => {
    const res = await run(makeCharacter(5), () => 0.999);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.message).toContain("no breakthrough");
    const pipeline = findOneAndUpdate.mock.calls[0]![1] as [{ $set: Record<string, unknown> }];
    expect("stats.debate" in pipeline[0].$set).toBe(false);
    expect(pipeline[0].$set.actions).toEqual({ $subtract: ["$actions", 1] });
  });

  it("still executes at the Debate cap, preserving the historical charge", async () => {
    const res = await run(makeCharacter(10), () => 0);
    expect(res.ok).toBe(true);
  });
});
