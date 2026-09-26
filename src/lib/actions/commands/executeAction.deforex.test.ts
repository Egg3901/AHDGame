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
import { getGameState } from "@/lib/gameState";
import { getGdpBaseline } from "@/lib/utils/fundGeneration";

describe("executeCharacterAction — campaign-fund de-forex", () => {
  let findOneAndUpdate: ReturnType<typeof vi.fn>;

  function makeDb(character: Character, baseRate?: number): Db {
    findOneAndUpdate = vi.fn().mockResolvedValue({ ...character, actions: 90 });
    return {
      collection: vi.fn((name: string) => {
        if (name === "exchangeRates")
          return {
            find: () => ({
              toArray: async () =>
                baseRate == null
                  ? []
                  : [
                      {
                        currencyCode: character.countryId === "DE" ? "EUR" : "NGN",
                        baseRate,
                        rate: 9999,
                      },
                    ],
            }),
          };
        if (name === "states") {
          // Average-GDP home state: per-capita GDP hits the country baseline
          // exactly, so the GDP scalar is 1.0 and the advertise cost is the
          // unscaled tier price (100,000 anchor at fav 0). The advertise quote
          // requires home-state economics instead of a null-state fallback.
          const countryId = character.countryId ?? "US";
          return {
            findOne: vi.fn().mockResolvedValue({
              gdp: getGdpBaseline(countryId),
              population: 1_000_000,
            }),
          };
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
      // Neutral charisma (pivot 5.5 → 1.0x): the advertise quote requires an
      // allocated stat and owns the multiplier interpretation.
      stats: { charisma: 5.5 },
      currencyBalances: { campaign: 1_000_000_000_000, personal: {} },
    }) as unknown as Character;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 1, preset: undefined } as never);
  });

  async function campaignDebit(countryId: string, baseRate?: number): Promise<number> {
    const character = makeCharacter(countryId);
    const db = makeDb(character, baseRate);
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

  it("debits a 1953 NG campaign at its seeded basis without following live FX", async () => {
    expect(await campaignDebit("NG", 0.357)).toBe(-35_700);
  });

  it("debits the US campaign at the frozen rate (×1.0)", async () => {
    expect(await campaignDebit("US")).toBe(-100_000);
  });

  it("debits the NG campaign at the frozen rate (×1550), ignoring the live 9999 rate", async () => {
    expect(await campaignDebit("NG")).toBe(-100_000 * 1550);
  });

  it("debits a 2027 DE campaign in its frozen EUR denomination", async () => {
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 1, preset: "2027-default" } as never);
    // The 2027 price-level quote is 90,000 anchor before the EUR basis ×0.92.
    expect(await campaignDebit("DE", 0.92)).toBe(-82_800);
  });
});
