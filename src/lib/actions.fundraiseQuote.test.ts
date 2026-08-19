/**
 * Ticket 1107: the Fundraise card advertised ~M1.8M in a 1953 East Germany
 * while the action credited ~M1.0M.
 *
 * Two independent causes, both regression-guarded here:
 *   1. The card recomputed the yield inline and omitted the fundraising stat
 *      multiplier that the action effect applies.
 *   2. The card converted the anchor yield at the LIVE forex rate (DDM 4.2 in a
 *      1953 world) while executeAction credits at the FROZEN campaign base rate
 *      (DDM 2.22). Ratio 4.2 / 2.22 = 1.89x, which is the whole reported gap.
 */
import { describe, it, expect } from "vitest";
import type { Character } from "@/lib/db/types";
import { ACTIONS, fundraiseYieldAnchor, fundraiseYieldLocal } from "./actions";
import { campaignAnchorToLocal, campaignLocalRate } from "@/lib/campaigns/campaignCurrency";

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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Character;
}

describe("fundraiseYieldAnchor is the single source of truth", () => {
  it("equals exactly what the Fundraise action effect credits", () => {
    const char = makeCharacter({
      donorBaseLevel: 84,
      politicalInfluence: 92.22397672847659,
      stats: { charisma: 10, debate: 6, energy: 10, fundraising: 10 },
    } as Partial<Character>);
    const effect = ACTIONS.fundraise.effect(char);
    expect(effect.fundsChange).toBe(fundraiseYieldAnchor(char));
  });

  it("includes the fundraising stat multiplier the old card formula dropped", () => {
    const base = { donorBaseLevel: 50, politicalInfluence: 40 };
    const strong = makeCharacter({ ...base, stats: { fundraising: 10 } } as Partial<Character>);
    const weak = makeCharacter({ ...base, stats: { fundraising: 1 } } as Partial<Character>);
    // The pre-fix card formula, identical for both characters.
    const oldCardFormula = Math.round((50_000 + 50 * 2_000) * 1.4);
    expect(fundraiseYieldAnchor(strong)).toBeGreaterThan(oldCardFormula);
    expect(fundraiseYieldAnchor(weak)).toBeLessThan(oldCardFormula);
    expect(fundraiseYieldAnchor(strong)).not.toBe(fundraiseYieldAnchor(weak));
  });
});

describe("fundraiseYieldLocal matches the credited local amount", () => {
  it("converts at the frozen campaign base rate, not the live forex rate", () => {
    const char = makeCharacter({
      countryId: "DD",
      donorBaseLevel: 84,
      politicalInfluence: 92.22397672847659,
      stats: { fundraising: 10 },
    } as Partial<Character>);

    const credited = campaignAnchorToLocal(ACTIONS.fundraise.effect(char).fundsChange!, "DD");
    expect(fundraiseYieldLocal(char, true)).toBe(credited);

    // The live 1953 DDM rate is 4.2 against a frozen campaign rate of 2.22.
    // Quoting at the live rate is what produced the ~1.8x overstatement.
    const liveRate1953 = 4.2;
    const quotedAtLiveRate = Math.round(fundraiseYieldAnchor(char) * liveRate1953);
    expect(quotedAtLiveRate / fundraiseYieldLocal(char, true)).toBeCloseTo(
      liveRate1953 / campaignLocalRate("DD"),
      2
    );
    expect(quotedAtLiveRate).toBeGreaterThan(fundraiseYieldLocal(char, true) * 1.5);
  });

  it("stays in anchor units when forex is disabled", () => {
    const char = makeCharacter({ countryId: "DD", donorBaseLevel: 20 });
    expect(fundraiseYieldLocal(char, false)).toBe(fundraiseYieldAnchor(char));
  });

  it("is a no-op conversion for the anchor country", () => {
    const char = makeCharacter({ countryId: "US", donorBaseLevel: 20 });
    expect(fundraiseYieldLocal(char, true)).toBe(fundraiseYieldAnchor(char));
  });
});
