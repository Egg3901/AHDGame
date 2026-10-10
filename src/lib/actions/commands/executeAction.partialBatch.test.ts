import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";

// A batch commits one iteration at a time. When AP runs out partway, the
// earlier iterations are already paid, so the run must report a partial
// success (the client only refreshes the character on a 2xx).
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 1, preset: undefined }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/stats/featureFlag", () => ({
  isRpgStatsEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/achievements/triggers", () => ({
  checkActionAchievements: vi.fn().mockResolvedValue(undefined),
  checkFundsAchievements: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAuditBulk: vi.fn() }));

import { executeCharacterAction } from "./executeAction";
import { recordAuditBulk } from "@/lib/audit/recordAudit";

const FUNDRAISE_AP = 3;

describe("executeCharacterAction: partial batch", () => {
  function makeDb(start: Character) {
    let current: Character = { ...start };
    const findOneAndUpdate = vi.fn(async (filter: Record<string, unknown>) => {
      const need = (filter.actions as { $gte: number }).$gte;
      if ((current.actions ?? 0) < need) return null;
      current = {
        ...current,
        actions: (current.actions ?? 0) - need,
        funds: (current.funds ?? 0) + 1000,
      };
      return { ...current };
    });
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "characters") {
          return { findOne: vi.fn(async () => ({ ...current })), findOneAndUpdate };
        }
        if (name === "exchangeRates") return { find: () => ({ toArray: async () => [] }) };
        return {
          insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    } as unknown as Db;
    return { db, findOneAndUpdate };
  }

  const makeCharacter = (actions: number): Character =>
    ({
      _id: new ObjectId(),
      name: "Raiser",
      countryId: "US",
      homeState: "US-NY",
      party: "6",
      actions,
      funds: 0,
      donorBaseLevel: 5,
      favorability: 20,
      politicalInfluence: 10,
    }) as unknown as Character;

  beforeEach(() => vi.clearAllMocks());

  it("returns ok with a stop note when AP runs out mid-batch", async () => {
    const character = makeCharacter(FUNDRAISE_AP * 2 + 1);
    const { db, findOneAndUpdate } = makeDb(character);
    const res = await executeCharacterAction(db, {
      character,
      characterQuery: { _id: character._id },
      actionType: "fundraise",
      count: 5,
      actor: { userId: new ObjectId(), username: "tester" },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(res.updatedCharacter.actions).toBe(1);
    expect(res.message).toMatch(/^Stopped after 2 of 5:/);
    expect(res.message).toContain("Completed 2 times.");
    // Audit rows for the committed iterations are still flushed.
    expect(vi.mocked(recordAuditBulk).mock.calls[0]![0]).toHaveLength(2);
  });

  it("still errors when the very first iteration is refused", async () => {
    const character = makeCharacter(1);
    const { db } = makeDb(character);
    const res = await executeCharacterAction(db, {
      character,
      characterQuery: { _id: character._id },
      actionType: "fundraise",
      count: 5,
      actor: { userId: new ObjectId(), username: "tester" },
    });
    expect(res.ok).toBe(false);
  });

  it("completes a full batch with no stop note", async () => {
    const character = makeCharacter(30);
    const { db } = makeDb(character);
    const res = await executeCharacterAction(db, {
      character,
      characterQuery: { _id: character._id },
      actionType: "fundraise",
      count: 5,
      actor: { userId: new ObjectId(), username: "tester" },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.message).not.toContain("Stopped");
  });
});
