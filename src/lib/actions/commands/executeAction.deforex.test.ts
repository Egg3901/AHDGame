import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";

// Campaign funds are decoupled from live forex: the campaign-fund debit must use
// the frozen INITIAL_RATES scale (NG ×1550), NOT the live exchange rate. We mock
// loadCharacterFxRate to a sentinel 9999 to prove it is ignored for campaign funds.
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
vi.mock("@/lib/currency/characterFunds", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/currency/characterFunds")>();
  return {
    ...actual,
    loadCharacterFxRate: vi.fn().mockResolvedValue({ rate: 9999, ok: true }),
  };
});

import { executeCharacterAction } from "./executeAction";

describe("executeCharacterAction — campaign-fund de-forex", () => {
  let findOneAndUpdate: ReturnType<typeof vi.fn>;

  function makeDb(character: Character): Db {
    findOneAndUpdate = vi.fn().mockResolvedValue({ ...character, actions: 90 });
    return {
      collection: vi.fn((name: string) => {
        if (name === "states") {
          // Null state → advertise cost is country-independent (100,000 anchor at fav 0).
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
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

  const makeCharacter = (countryId: string): Character =>
    ({
      _id: new ObjectId(),
      name: "Ad Buyer",
      countryId,
      homeState: `${countryId}-SW`,
      party: "6",
      favorability: 0, // tier 0 → advertise cost = exactly 100,000 anchor
      actions: 100,
      donorBaseLevel: 0,
      funds: 0,
      currencyBalances: { campaign: 1_000_000_000_000, personal: {} },
    }) as unknown as Character;

  beforeEach(() => vi.clearAllMocks());

  async function campaignDebit(countryId: string): Promise<number> {
    const character = makeCharacter(countryId);
    const db = makeDb(character);
    const res = await executeCharacterAction(db, {
      character,
      characterQuery: { _id: character._id },
      actionType: "advertise",
      actor: { userId: null },
    });
    expect(res.ok).toBe(true);
    const pipeline = findOneAndUpdate.mock.calls[0]![1] as [{ $set: Record<string, unknown> }];
    const campaignAdd = (pipeline[0].$set["currencyBalances.campaign"] as { $add: unknown[] }).$add;
    return campaignAdd[1] as number;
  }

  it("debits the US campaign at the frozen rate (×1.0)", async () => {
    expect(await campaignDebit("US")).toBe(-100_000);
  });

  it("debits the NG campaign at the frozen rate (×1550), ignoring the live 9999 rate", async () => {
    expect(await campaignDebit("NG")).toBe(-100_000 * 1550);
  });
});
