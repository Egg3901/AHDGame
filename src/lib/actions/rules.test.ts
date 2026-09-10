/**
 * Fundraise portable rules (Game1724): single-owner AP cost, yield formula,
 * and donor-level-zero eligibility live in `./rules`. `../actions` re-exports
 * the same names so existing quote/effect callers need no rewrite.
 */
import { describe, it, expect } from "vitest";
import type { Character } from "@/lib/db/types";
import {
  FUNDRAISE_ACTION_COST,
  calculateFundraisingAmount,
  fundraiseYieldAnchor,
  isFundraiseEligible,
} from "./rules";
import { ACTIONS, canPerformAction, getDonorActionCost, getActionPointCost } from "../actions";

function makeCharacter(overrides: Partial<Character>): Character {
  return {
    _id: "test" as unknown as import("mongodb").ObjectId,
    userId: "u" as unknown as import("mongodb").ObjectId,
    name: "Test",
    homeState: "NY",
    countryId: "US",
    party: "independent",
    actions: 10,
    funds: 1_000_000,
    cashOnHand: 0,
    savingsOnHand: 0,
    favorability: 0,
    infamy: 0,
    donorBaseLevel: 0,
    politicalInfluence: 0,
    demographics: { race: "white", gender: "male", education: "college", wealth: "middle" },
    policies: { economic: 0, social: 0 },
    createdAt: new Date("2026-09-10T00:00:00.000Z"),
    updatedAt: new Date("2026-09-10T00:00:00.000Z"),
    ...overrides,
  } as Character;
}

describe("Fundraise action point quotes", () => {
  it("costs 3 AP at every donor level", () => {
    expect(FUNDRAISE_ACTION_COST).toBe(3);
    expect(ACTIONS.fundraise.baseCost).toBe(3);
    for (const level of [0, 10, 50, 75]) {
      expect(getDonorActionCost(level, "fundraise")).toBe(3);
      expect(getActionPointCost(makeCharacter({ donorBaseLevel: level }), "fundraise")).toBe(3);
    }
  });
});

describe("calculateFundraisingAmount independent literals", () => {
  it("L0/0% pays the $50K floor", () => {
    expect(calculateFundraisingAmount(0, 0)).toBe(50_000);
  });
  it("L50/50% pays $225K", () => {
    expect(calculateFundraisingAmount(50, 50)).toBe(225_000);
  });
  it("L75/100% pays $400K", () => {
    expect(calculateFundraisingAmount(75, 100)).toBe(400_000);
  });
  it("omitted influence skips the state multiplier", () => {
    expect(calculateFundraisingAmount(50)).toBe(150_000);
  });
});

describe("fundraiseYieldAnchor stat bounds and missing-donor fallback", () => {
  const base = { donorBaseLevel: 50, politicalInfluence: 40 };
  it("neutral fallback for characters that predate the stat system", () => {
    const old = makeCharacter({ ...base, stats: undefined });
    expect(fundraiseYieldAnchor(old)).toBe(210_000);
  });
  it("stat bounds clamp through the shared multiplier (no copied math)", () => {
    const weak = makeCharacter({ ...base, stats: { fundraising: 1 } } as Partial<Character>);
    const strong = makeCharacter({ ...base, stats: { fundraising: 10 } } as Partial<Character>);
    const belowFloor = makeCharacter({ ...base, stats: { fundraising: -5 } } as Partial<Character>);
    const aboveCap = makeCharacter({ ...base, stats: { fundraising: 99 } } as Partial<Character>);
    expect(fundraiseYieldAnchor(weak)).toBe(172_200);
    expect(fundraiseYieldAnchor(strong)).toBe(247_800);
    expect(fundraiseYieldAnchor(belowFloor)).toBe(172_200);
    expect(fundraiseYieldAnchor(aboveCap)).toBe(247_800);
  });
});

describe("donor-level-zero eligibility", () => {
  it("level 0 is ineligible, level 1+ is eligible", () => {
    expect(isFundraiseEligible(0)).toBe(false);
    expect(isFundraiseEligible(1)).toBe(true);
    expect(isFundraiseEligible(75)).toBe(true);
  });
  it("the execute gate still blocks level 0 with the existing reason", () => {
    const result = makeCharacter({ actions: 10, donorBaseLevel: 0 });
    expect(canPerformAction(result, "fundraise")).toEqual({
      canPerform: false,
      reason:
        "You have no donor base. Use 'Build Donor Network' first to establish one before fundraising.",
    });
  });
});

describe("quote matches effect through the shared rule", () => {
  it("the Fundraise effect credits exactly fundraiseYieldAnchor", () => {
    const char = makeCharacter({
      donorBaseLevel: 50,
      politicalInfluence: 40,
      stats: { fundraising: 10 },
    } as Partial<Character>);
    expect(ACTIONS.fundraise.effect(char).fundsChange).toBe(247_800);
  });
});
