import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";

// Rest runs through the generic execute path (no dedicated route): the shell
// reads its AP cost from getActionPointCost and its gate from
// canPerformAction, both owned by the shared rest quote. Mock the ambient
// shell inputs; the Db is fully mocked (no memory server).
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 1, preset: undefined }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/stats/featureFlag", () => ({
  isRpgStatsEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkActionAchievements: vi.fn().mockResolvedValue(undefined),
  checkFundsAchievements: vi.fn().mockResolvedValue(undefined),
}));

import { executeCharacterAction } from "./executeAction";
import { REST_RESULT_MESSAGE } from "@/lib/actions/rules";

describe("executeCharacterAction — rest", () => {
  let findOneAndUpdate: ReturnType<typeof vi.fn>;

  function makeDb(character: Character): Db {
    findOneAndUpdate = vi.fn().mockResolvedValue({ ...character });
    return {
      collection: vi.fn((name: string) => {
        if (name === "exchangeRates") return { find: () => ({ toArray: async () => [] }) };
        if (name === "characters") {
          return { findOne: vi.fn().mockResolvedValue(character), findOneAndUpdate };
        }
        return {
          insertOne: vi.fn().mockResolvedValue({}),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    } as unknown as Db;
  }

  const makeCharacter = (): Character =>
    ({
      _id: new ObjectId(),
      name: "Rester",
      countryId: "US",
      homeState: "US-NY",
      party: "6",
      actions: 5,
      funds: 500_000,
      favorability: 20,
      politicalInfluence: 10,
    }) as unknown as Character;

  beforeEach(() => vi.clearAllMocks());

  it("executes rest with zero AP charge, no fund movement and the shared message", async () => {
    const character = makeCharacter();
    const db = makeDb(character);
    const res = await executeCharacterAction(db, {
      character,
      characterQuery: { _id: character._id },
      actionType: "rest",
      actor: { userId: null },
    });
    expect(res).toEqual({
      ok: true,
      updatedCharacter: { ...character },
      message: REST_RESULT_MESSAGE,
    });
    const updateFilter = findOneAndUpdate.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateFilter.actions).toEqual({ $gte: 0 });
    const pipeline = findOneAndUpdate.mock.calls[0]![1] as [{ $set: Record<string, unknown> }];
    const set = pipeline[0].$set;
    expect(set.actions).toEqual({ $subtract: ["$actions", 0] });
    expect("funds" in set).toBe(false);
    expect("currencyBalances.campaign" in set).toBe(false);
  });

  it("rests a fully spent character: the zero-cost gate never blocks", async () => {
    const character = makeCharacter();
    character.actions = 0;
    const db = makeDb(character);
    const res = await executeCharacterAction(db, {
      character,
      characterQuery: { _id: character._id },
      actionType: "rest",
      actor: { userId: null },
    });
    expect(res.ok).toBe(true);
  });
});
