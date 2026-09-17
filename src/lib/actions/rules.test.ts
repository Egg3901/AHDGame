/**
 * Fundraise portable rules (Game1724): single-owner AP cost, yield formula,
 * and donor-level-zero eligibility live in `./rules`. `../actions` re-exports
 * the same names so existing quote/effect callers need no rewrite.
 */
import { describe, it, expect } from "vitest";
import type { Character, State } from "@/lib/db/types";
import type { CharacterStats } from "@/lib/stats/statsConstants";
import { statMultiplier } from "@/lib/stats/statMultiplier";
import {
  FUNDRAISE_ACTION_COST,
  calculateFundraisingAmount,
  fundraiseYieldAnchor,
  isFundraiseEligible,
  CAMPAIGN_BASE_FUND_COST,
  getCampaignActionCost,
  getCampaignFundCost,
  campaignInfluenceGain,
  isCampaignEligible,
  quoteCampaignAction,
  ADVERTISE_BASE_FUND_COST,
  getAdvertiseActionCost,
  getAdvertiseFundCost,
  advertiseFavorabilityGain,
  quoteAdvertiseAction,
  BUILD_DONOR_BASE_FUND,
  BUILD_DONOR_BASE_FUND_PER_LEVEL,
  BUILD_DONOR_BASE_LEVEL_GAIN,
  getBuildDonorBaseActionCost,
  getBuildDonorBaseFundCost,
  quoteBuildDonorBaseAction,
  CONVERT_CASH_ACTION_COST,
  CONVERT_CASH_RATE,
  calculateConvertCashInfamy,
  convertCashConversion,
  quoteConvertCashAction,
} from "./rules";
import {
  ACTIONS,
  canPerformAction,
  getDonorActionCost,
  getActionPointCost,
  simulateActionBatch,
} from "../actions";

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

// ── Campaign (Game1724 slice 2) ─────────────────────────────────────────────
// quoteCampaignAction owns the tiered AP cost, the GDP-scaled fund cost and
// the stat-scaled influence gain. The UI quote, getActionPointCost (debit),
// the action effect (result) and canPerformAction (failure) all route through
// it, so the numbers below prove agreement instead of re-stating the formula.

const NEUTRAL_STATS: CharacterStats = {
  charisma: 5.5,
  debate: 5.5,
  energy: 5.5,
  fundraising: 5.5,
  businessAcumen: 5.5,
  statecraft: 5.5,
  intellect: 5.5,
};

const campaignStats = (charisma: number, intellect: number): CharacterStats => ({
  ...NEUTRAL_STATS,
  charisma,
  intellect,
});

function campaignCharacter(
  influence: number,
  charisma = 5.5,
  intellect = 5.5,
  overrides: Partial<Character> = {}
): Character {
  return makeCharacter({
    actions: 100,
    funds: 100_000_000,
    politicalInfluence: influence,
    countryId: "US",
    stats: campaignStats(charisma, intellect),
    ...overrides,
  });
}

function campaignState(): State {
  return {
    name: "Test State",
    gdp: 65_000,
    population: 1_000_000,
    countryId: "US",
  } as unknown as State;
}

function richState(): State {
  return {
    name: "Rich State",
    gdp: 3_664_000,
    population: 39_000_000,
    countryId: "US",
  } as unknown as State;
}

describe("campaign base cost is single-sourced", () => {
  it("pins the $20K base the fund formula scales", () => {
    expect(CAMPAIGN_BASE_FUND_COST).toBe(20_000);
  });
  it("AP tiers agree across the rules, the debit path and the quote", () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [19, 1],
      [20, 2],
      [39, 2],
      [40, 3],
      [59, 3],
      [60, 4],
      [79, 4],
      [80, 5],
      [99, 5],
      [100, 5],
    ];
    for (const [influence, tier] of cases) {
      expect(getCampaignActionCost(influence)).toBe(tier);
      expect(getActionPointCost(campaignCharacter(influence), "campaign")).toBe(tier);
    }
  });
});

describe("campaign quote matches debit and result through one source", () => {
  it("pins the baseline quote (influence 0, average GDP, neutral stats)", () => {
    const quote = quoteCampaignAction(
      { politicalInfluence: 0, charisma: 5.5, intellect: 5.5 },
      { gdpMillions: 65_000, population: 1_000_000, countryId: "US" }
    );
    expect(quote).toEqual({ ok: true, apCost: 1, fundCostAnchor: 20_000, influenceGain: 1 });
  });
  it("quote, AP debit, fund debit and result agree across a sweep", () => {
    const influences = [0, 10, 19, 20, 45, 65, 85, 99];
    const statPairs: Array<[number, number]> = [
      [1, 1],
      [5.5, 5.5],
      [10, 10],
      [1, 10],
      [10, 1],
    ];
    for (const state of [campaignState(), richState()]) {
      for (const influence of influences) {
        for (const [charisma, intellect] of statPairs) {
          const char = campaignCharacter(influence, charisma, intellect);
          const quote = quoteCampaignAction(
            { politicalInfluence: influence, charisma, intellect },
            { gdpMillions: state.gdp, population: state.population, countryId: "US" }
          );
          expect(quote.ok).toBe(true);
          if (!quote.ok) continue;
          // Debit side: AP cost and the effect result carry the same numbers.
          expect(getActionPointCost(char, "campaign")).toBe(quote.apCost);
          const effect = ACTIONS.campaign.effect(char, state);
          expect(effect.fundsChange).toBe(-quote.fundCostAnchor);
          expect(effect.politicalInfluenceChange).toBe(quote.influenceGain);
          // The quote itself applies the historical math, not a copy of it.
          expect(quote.apCost).toBe(getCampaignActionCost(influence));
          expect(quote.fundCostAnchor).toBe(
            Math.round(
              getCampaignFundCost(influence, state.gdp, state.population, "US") /
                statMultiplier(intellect)
            )
          );
          expect(quote.influenceGain).toBe(
            campaignInfluenceGain(influence, statMultiplier(charisma))
          );
        }
      }
    }
  });
  it("a test-only influence bump moves quote and debit together", () => {
    // One base input changes (influence 10 -> 85, crossing AP tiers 1 -> 5);
    // both the displayed quote and the debited/applied result must follow it
    // through the same function, with no second formula edit.
    const target = { gdpMillions: 65_000, population: 1_000_000, countryId: "US" };
    const before = quoteCampaignAction(
      { politicalInfluence: 10, charisma: 5.5, intellect: 5.5 },
      target
    );
    const after = quoteCampaignAction(
      { politicalInfluence: 85, charisma: 5.5, intellect: 5.5 },
      target
    );
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.apCost).toBe(5);
    expect(after.apCost).toBeGreaterThan(before.apCost);
    expect(after.fundCostAnchor).toBeGreaterThan(before.fundCostAnchor);
    const state = campaignState();
    const effectBefore = ACTIONS.campaign.effect(campaignCharacter(10), state);
    const effectAfter = ACTIONS.campaign.effect(campaignCharacter(85), state);
    expect(effectBefore.fundsChange).toBe(-before.fundCostAnchor);
    expect(effectAfter.fundsChange).toBe(-after.fundCostAnchor);
    expect(effectAfter.politicalInfluenceChange).toBe(after.influenceGain);
    expect(getActionPointCost(campaignCharacter(85), "campaign")).toBe(after.apCost);
    expect(getActionPointCost(campaignCharacter(10), "campaign")).toBe(before.apCost);
  });
  it("a test-only charisma bump moves quoted and applied gain together", () => {
    const target = { gdpMillions: 65_000, population: 1_000_000, countryId: "US" };
    const weak = quoteCampaignAction(
      { politicalInfluence: 20, charisma: 1, intellect: 5.5 },
      target
    );
    const strong = quoteCampaignAction(
      { politicalInfluence: 20, charisma: 10, intellect: 5.5 },
      target
    );
    expect(weak.ok && strong.ok).toBe(true);
    if (!weak.ok || !strong.ok) return;
    expect(strong.influenceGain).toBeGreaterThan(weak.influenceGain);
    const state = campaignState();
    expect(ACTIONS.campaign.effect(campaignCharacter(20, 1), state).politicalInfluenceChange).toBe(
      weak.influenceGain
    );
    expect(ACTIONS.campaign.effect(campaignCharacter(20, 10), state).politicalInfluenceChange).toBe(
      strong.influenceGain
    );
  });
});

describe("campaign failure agreement", () => {
  it("maxed influence rejects quote, validation and batch with one reason", () => {
    const reason = "Your political influence is already at maximum (100%).";
    expect(isCampaignEligible(99)).toBe(true);
    expect(isCampaignEligible(100)).toBe(false);
    const quote = quoteCampaignAction(
      { politicalInfluence: 100, charisma: 5.5, intellect: 5.5 },
      { gdpMillions: 65_000, population: 1_000_000, countryId: "US" }
    );
    expect(quote).toEqual({ ok: false, error: reason });
    expect(canPerformAction(campaignCharacter(100), "campaign", campaignState())).toEqual({
      canPerform: false,
      reason,
    });
    expect(simulateActionBatch(campaignCharacter(100), campaignState(), "campaign", 5)).toEqual({
      ok: false,
      reason,
    });
  });
  it("missing stats reject quote and validation with the same reason", () => {
    const noStats = makeCharacter({
      actions: 100,
      funds: 100_000_000,
      politicalInfluence: 20,
      countryId: "US",
      stats: undefined,
    });
    const quote = quoteCampaignAction(
      { politicalInfluence: 20, charisma: undefined, intellect: undefined },
      { gdpMillions: 65_000, population: 1_000_000, countryId: "US" }
    );
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.error).toMatch(/charisma/);
    expect(canPerformAction(noStats, "campaign", campaignState())).toEqual({
      canPerform: false,
      reason: quote.error,
    });
  });
  it("missing target rejects quote and validation with the same reason", () => {
    const quote = quoteCampaignAction(
      { politicalInfluence: 20, charisma: 5.5, intellect: 5.5 },
      undefined
    );
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(canPerformAction(campaignCharacter(20), "campaign", undefined)).toEqual({
      canPerform: false,
      reason: quote.error,
    });
  });
  it("degenerate targets reject instead of pricing", () => {
    const actor = { politicalInfluence: 20, charisma: 5.5, intellect: 5.5 };
    expect(
      quoteCampaignAction(actor, { gdpMillions: 65_000, population: 0, countryId: "US" }).ok
    ).toBe(false);
    expect(quoteCampaignAction(actor, { gdpMillions: 65_000, population: 1_000_000 }).ok).toBe(
      false
    );
  });
});
// ── Advertise (Game1724 slice) ──────────────────────────────────────────────
// Average-GDP US home state: gdpPerCapita = 65_000 × 1M / 1M hits the 65_000
// baseline exactly, so the GDP scalar is 1.0 and fund pins read straight off
// the tier multiplier ($100K × (1 + tier × 0.2)).
const AVG_STATE = { gdp: 65_000, population: 1_000_000, name: "Test State" } as State;
const AVG_TARGET = { gdpMillions: 65_000, population: 1_000_000, countryId: "US" };
// Charisma 5.5 is the neutral pivot: statMultiplier is exactly 1.0, so gain
// pins read straight off the diminishing-returns curve (base +3).
const NEUTRAL_CHARISMA = { charisma: 5.5 };

function advertiseCharacter(favorability: number, charisma?: number | null): Character {
  return makeCharacter({
    favorability,
    stats: charisma === null ? undefined : { charisma: charisma ?? 5.5 },
  } as Partial<Character>);
}

describe("Advertise action point quotes", () => {
  it("tiers 5-9 AP across favorability through the shared rule", () => {
    for (const favorability of [0, 10, 29, 30, 50, 70, 85, 100]) {
      expect(getActionPointCost(advertiseCharacter(favorability), "advertise")).toBe(
        getAdvertiseActionCost(favorability)
      );
    }
    expect(ADVERTISE_BASE_FUND_COST).toBe(100_000);
  });
});

describe("getAdvertiseFundCost independent literals", () => {
  it("tier 0 at average GDP costs the $100K base", () => {
    expect(getAdvertiseFundCost(0, 65_000, 1_000_000)).toBe(100_000);
  });
  it("tier 2 (fav 50) at average GDP costs $140K", () => {
    expect(getAdvertiseFundCost(50, 65_000, 1_000_000)).toBe(140_000);
  });
  it("tier 4 (fav 90) at average GDP costs $180K", () => {
    expect(getAdvertiseFundCost(90, 65_000, 1_000_000)).toBe(180_000);
  });
});

describe("advertiseFavorabilityGain independent literals", () => {
  it("base +3 at low favorability, neutral charisma", () => {
    expect(advertiseFavorabilityGain(0, 1)).toBe(3);
  });
  it("diminishing returns above 70 (fav 90 → +1)", () => {
    expect(advertiseFavorabilityGain(90, 1)).toBe(1);
  });
  it("floors at 1 so an ad is never fully wasted", () => {
    expect(advertiseFavorabilityGain(100, 1)).toBe(1);
  });
});

describe("quoteAdvertiseAction strictness", () => {
  it("quotes AP cost, anchor fund cost and gain from one source", () => {
    const quote = quoteAdvertiseAction({ favorability: 0, ...NEUTRAL_CHARISMA }, AVG_TARGET);
    expect(quote).toEqual({ ok: true, apCost: 5, fundCostAnchor: 100_000, favorabilityGain: 3 });
  });
  it("rejects a missing charisma stat instead of neutral-scaling the gain", () => {
    const quote = quoteAdvertiseAction({ favorability: 10 }, AVG_TARGET);
    expect(quote.ok).toBe(false);
    expect(quote.ok ? "" : quote.error).toContain("charisma");
  });
  it("rejects a missing home-state target instead of unscaled tier pricing", () => {
    const quote = quoteAdvertiseAction({ favorability: 10, ...NEUTRAL_CHARISMA });
    expect(quote.ok).toBe(false);
    expect(quote.ok ? "" : quote.error).toContain("home-state");
  });
  it("rejects a missing country basis", () => {
    const quote = quoteAdvertiseAction(
      { favorability: 10, ...NEUTRAL_CHARISMA },
      { gdpMillions: 65_000, population: 1_000_000 }
    );
    expect(quote.ok).toBe(false);
    expect(quote.ok ? "" : quote.error).toContain("country");
  });
});

describe("Advertise quote/debit/result agreement", () => {
  it("effect debits and credits exactly what the quote advertises, across tiers", () => {
    for (const favorability of [0, 29, 30, 50, 70, 85, 100]) {
      const char = advertiseCharacter(favorability);
      const quote = quoteAdvertiseAction({ favorability, ...NEUTRAL_CHARISMA }, AVG_TARGET);
      expect(quote.ok).toBe(true);
      if (!quote.ok) continue;
      expect(getActionPointCost(char, "advertise")).toBe(quote.apCost);
      const effect = ACTIONS.advertise.effect(char, AVG_STATE);
      expect(effect.fundsChange).toBe(-quote.fundCostAnchor);
      expect(effect.favorabilityChange).toBe(quote.favorabilityGain);
    }
  });
  it("the execute gate surfaces the quote reason for missing stats", () => {
    const char = makeCharacter({ actions: 10, favorability: 10, funds: 1_000_000 });
    expect(canPerformAction(char, "advertise", AVG_STATE)).toEqual({
      canPerform: false,
      reason:
        "Advertise requires an allocated charisma stat. Allocate your stats before advertising.",
    });
  });
  it("the execute gate surfaces the quote reason for a missing state", () => {
    const char = advertiseCharacter(10);
    expect(canPerformAction(char, "advertise")).toEqual({
      canPerform: false,
      reason: "Advertise requires home-state economic data (GDP and population).",
    });
  });
});

describe("Advertise single-source sensitivity", () => {
  it("one favorability bump moves the quote, the AP debit and the effect together", () => {
    const before = quoteAdvertiseAction({ favorability: 10, ...NEUTRAL_CHARISMA }, AVG_TARGET);
    const after = quoteAdvertiseAction({ favorability: 85, ...NEUTRAL_CHARISMA }, AVG_TARGET);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    // No second formula edit: AP cost, fund cost and effect all follow the one input.
    expect([before.apCost, after.apCost]).toEqual([5, 9]);
    expect([before.fundCostAnchor, after.fundCostAnchor]).toEqual([100_000, 180_000]);
    expect(getActionPointCost(advertiseCharacter(10), "advertise")).toBe(before.apCost);
    expect(getActionPointCost(advertiseCharacter(85), "advertise")).toBe(after.apCost);
    expect(ACTIONS.advertise.effect(advertiseCharacter(10), AVG_STATE).fundsChange).toBe(
      -before.fundCostAnchor
    );
    expect(ACTIONS.advertise.effect(advertiseCharacter(85), AVG_STATE).fundsChange).toBe(
      -after.fundCostAnchor
    );
  });
  it("one charisma bump moves the quoted gain and the credited gain together", () => {
    const weak = quoteAdvertiseAction({ favorability: 10, charisma: 1 }, AVG_TARGET);
    const strong = quoteAdvertiseAction({ favorability: 10, charisma: 10 }, AVG_TARGET);
    expect(weak.ok && strong.ok).toBe(true);
    if (!weak.ok || !strong.ok) return;
    expect(strong.favorabilityGain).toBeGreaterThan(weak.favorabilityGain);
    expect(ACTIONS.advertise.effect(advertiseCharacter(10, 1), AVG_STATE).favorabilityChange).toBe(
      weak.favorabilityGain
    );
    expect(ACTIONS.advertise.effect(advertiseCharacter(10, 10), AVG_STATE).favorabilityChange).toBe(
      strong.favorabilityGain
    );
  });
});

// ── BuildDonorBase (Game1724 slice 3) ───────────────────────────────────────
// quoteBuildDonorBaseAction owns the level-scaled AP cost, the GDP-scaled fund
// cost with the fundraising discount, and the +1 level gain. The UI quote,
// getActionPointCost (debit), the action effect (result) and canPerformAction
// (failure) all route through it, so the numbers below prove agreement
// instead of re-stating the formula.

const donorStats = (fundraising: number): CharacterStats => ({
  ...NEUTRAL_STATS,
  fundraising,
});

function donorCharacter(
  level: number,
  fundraising = 5.5,
  overrides: Partial<Character> = {}
): Character {
  return makeCharacter({
    actions: 100,
    funds: 100_000_000,
    donorBaseLevel: level,
    countryId: "US",
    stats: donorStats(fundraising),
    ...overrides,
  });
}

function donorState(): State {
  return {
    name: "Test State",
    gdp: 65_000,
    population: 1_000_000,
    countryId: "US",
  } as unknown as State;
}

const DONOR_TARGET = { gdpMillions: 65_000, population: 1_000_000, countryId: "US" };

describe("donor base cost is single-sourced", () => {
  it("pins the $3K base and $1.5K per-level scale the fund formula uses", () => {
    expect(BUILD_DONOR_BASE_FUND).toBe(3_000);
    expect(BUILD_DONOR_BASE_FUND_PER_LEVEL).toBe(1_500);
    expect(BUILD_DONOR_BASE_LEVEL_GAIN).toBe(1);
  });
  it("AP costs agree across the rules, the debit path and the quote", () => {
    const cases: Array<[number, number]> = [
      [0, 4],
      [10, 5],
      [25, 7],
      [50, 13],
      [65, 17],
      [75, 20],
    ];
    for (const [level, ap] of cases) {
      expect(getBuildDonorBaseActionCost(level)).toBe(ap);
      expect(getDonorActionCost(level, "buildDonorBase")).toBe(ap);
      expect(getActionPointCost(donorCharacter(level), "buildDonorBase")).toBe(ap);
    }
  });
});

describe("getBuildDonorBaseFundCost independent literals", () => {
  it("L0 at average GDP costs the $3K base", () => {
    expect(getBuildDonorBaseFundCost(0, 65_000, 1_000_000)).toBe(3_000);
  });
  it("L10 at average GDP costs $18K", () => {
    expect(getBuildDonorBaseFundCost(10, 65_000, 1_000_000)).toBe(18_000);
  });
  it("L50 at average GDP costs $78K", () => {
    expect(getBuildDonorBaseFundCost(50, 65_000, 1_000_000)).toBe(78_000);
  });
  it("L75 at average GDP costs $116K", () => {
    expect(getBuildDonorBaseFundCost(75, 65_000, 1_000_000)).toBe(116_000);
  });
});

describe("donor quote matches debit and result through one source", () => {
  it("pins the baseline quote (level 0, average GDP, neutral fundraising)", () => {
    const quote = quoteBuildDonorBaseAction({ donorBaseLevel: 0, fundraising: 5.5 }, DONOR_TARGET);
    expect(quote).toEqual({ ok: true, apCost: 4, fundCostAnchor: 3_000, donorGain: 1 });
  });
  it("pins the fundraising discount (level 0, weak vs strong stat)", () => {
    const weak = quoteBuildDonorBaseAction({ donorBaseLevel: 0, fundraising: 1 }, DONOR_TARGET);
    const strong = quoteBuildDonorBaseAction({ donorBaseLevel: 0, fundraising: 10 }, DONOR_TARGET);
    expect(weak).toEqual({ ok: true, apCost: 4, fundCostAnchor: 3_659, donorGain: 1 });
    expect(strong).toEqual({ ok: true, apCost: 4, fundCostAnchor: 2_542, donorGain: 1 });
  });
  it("quote, AP debit, fund debit and result agree across a sweep", () => {
    const levels = [0, 10, 25, 50, 65, 75];
    const fundraisingStats = [1, 5.5, 10];
    for (const state of [donorState(), richState()]) {
      for (const level of levels) {
        for (const fundraising of fundraisingStats) {
          const char = donorCharacter(level, fundraising);
          const quote = quoteBuildDonorBaseAction(
            { donorBaseLevel: level, fundraising },
            { gdpMillions: state.gdp, population: state.population, countryId: "US" }
          );
          expect(quote.ok).toBe(true);
          if (!quote.ok) continue;
          // Debit side: AP cost and the effect result carry the same numbers.
          expect(getActionPointCost(char, "buildDonorBase")).toBe(quote.apCost);
          const effect = ACTIONS.buildDonorBase.effect(char, state);
          expect(effect.fundsChange).toBe(-quote.fundCostAnchor);
          expect(effect.donorBaseLevelChange).toBe(quote.donorGain);
          // The quote itself applies the historical math, not a copy of it.
          expect(quote.apCost).toBe(getBuildDonorBaseActionCost(level));
          expect(quote.fundCostAnchor).toBe(
            Math.round(
              getBuildDonorBaseFundCost(level, state.gdp, state.population, "US") /
                statMultiplier(fundraising)
            )
          );
        }
      }
    }
  });
  it("a test-only level bump moves quote and debit together", () => {
    // One base input changes (level 10 -> 75, crossing AP tiers 5 -> 20);
    // both the displayed quote and the debited/applied result must follow it
    // through the same function, with no second formula edit.
    const before = quoteBuildDonorBaseAction(
      { donorBaseLevel: 10, fundraising: 5.5 },
      DONOR_TARGET
    );
    const after = quoteBuildDonorBaseAction({ donorBaseLevel: 75, fundraising: 5.5 }, DONOR_TARGET);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.apCost).toBe(20);
    expect(after.apCost).toBeGreaterThan(before.apCost);
    expect(after.fundCostAnchor).toBeGreaterThan(before.fundCostAnchor);
    const state = donorState();
    const effectBefore = ACTIONS.buildDonorBase.effect(donorCharacter(10), state);
    const effectAfter = ACTIONS.buildDonorBase.effect(donorCharacter(75), state);
    expect(effectBefore.fundsChange).toBe(-before.fundCostAnchor);
    expect(effectAfter.fundsChange).toBe(-after.fundCostAnchor);
    expect(effectAfter.donorBaseLevelChange).toBe(after.donorGain);
    expect(getActionPointCost(donorCharacter(75), "buildDonorBase")).toBe(after.apCost);
    expect(getActionPointCost(donorCharacter(10), "buildDonorBase")).toBe(before.apCost);
  });
  it("a test-only fundraising bump moves quoted and applied cost together", () => {
    const weak = quoteBuildDonorBaseAction({ donorBaseLevel: 25, fundraising: 1 }, DONOR_TARGET);
    const strong = quoteBuildDonorBaseAction({ donorBaseLevel: 25, fundraising: 10 }, DONOR_TARGET);
    expect(weak.ok && strong.ok).toBe(true);
    if (!weak.ok || !strong.ok) return;
    expect(weak.fundCostAnchor).toBeGreaterThan(strong.fundCostAnchor);
    const state = donorState();
    expect(ACTIONS.buildDonorBase.effect(donorCharacter(25, 1), state).fundsChange).toBe(
      -weak.fundCostAnchor
    );
    expect(ACTIONS.buildDonorBase.effect(donorCharacter(25, 10), state).fundsChange).toBe(
      -strong.fundCostAnchor
    );
  });
});

describe("donor failure agreement", () => {
  it("missing fundraising rejects quote, validation and batch with one reason", () => {
    const quote = quoteBuildDonorBaseAction(
      { donorBaseLevel: 10, fundraising: undefined },
      DONOR_TARGET
    );
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.error).toMatch(/fundraising/);
    const noStats = makeCharacter({
      actions: 100,
      funds: 100_000_000,
      donorBaseLevel: 10,
      countryId: "US",
      stats: undefined,
    });
    expect(canPerformAction(noStats, "buildDonorBase", donorState())).toEqual({
      canPerform: false,
      reason: quote.error,
    });
    expect(simulateActionBatch(noStats, donorState(), "buildDonorBase", 5)).toEqual({
      ok: false,
      reason: quote.error,
    });
  });
  it("missing target rejects quote and validation with the same reason", () => {
    const quote = quoteBuildDonorBaseAction({ donorBaseLevel: 10, fundraising: 5.5 }, undefined);
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(canPerformAction(donorCharacter(10), "buildDonorBase", undefined)).toEqual({
      canPerform: false,
      reason: quote.error,
    });
  });
  it("degenerate targets and levels reject instead of pricing", () => {
    const actor = { donorBaseLevel: 10, fundraising: 5.5 };
    expect(
      quoteBuildDonorBaseAction(actor, { gdpMillions: 65_000, population: 0, countryId: "US" }).ok
    ).toBe(false);
    expect(
      quoteBuildDonorBaseAction(actor, { gdpMillions: 65_000, population: 1_000_000 }).ok
    ).toBe(false);
    expect(
      quoteBuildDonorBaseAction({ donorBaseLevel: -1, fundraising: 5.5 }, DONOR_TARGET).ok
    ).toBe(false);
  });
  it("the effect throws the quote reason instead of pricing without context", () => {
    const noStats = makeCharacter({
      actions: 100,
      funds: 100_000_000,
      donorBaseLevel: 10,
      countryId: "US",
      stats: undefined,
    });
    expect(() => ACTIONS.buildDonorBase.effect(noStats, donorState())).toThrow(/fundraising/);
    expect(() => ACTIONS.buildDonorBase.effect(donorCharacter(10), undefined)).toThrow(
      /home-state/
    );
  });
});

// ── ConvertCash (Game1724 slice) ────────────────────────────────────────────
// quoteConvertCashAction owns the flat AP cost, the 50% conversion and the
// amount-scaled infamy. The default effect (result), the execute shell
// (debit), the AI advisor and the UI previews all route through the same
// conversion and infamy legs, so the numbers below prove agreement instead of
// re-stating the formula. The one behavior fix: the advisor's old inline
// infamy omitted the 100 cap the execution applies.

function cashCharacter(cashOnHand: number, overrides: Partial<Character> = {}): Character {
  return makeCharacter({
    actions: 100,
    funds: 0,
    cashOnHand,
    savingsOnHand: 0,
    ...overrides,
  });
}

describe("convert cash cost is single-sourced", () => {
  it("pins the flat 2 AP cost and the 50% rate the conversion uses", () => {
    expect(CONVERT_CASH_ACTION_COST).toBe(2);
    expect(CONVERT_CASH_RATE).toBe(0.5);
    expect(ACTIONS.convertCash.baseCost).toBe(CONVERT_CASH_ACTION_COST);
    expect(getActionPointCost(cashCharacter(500_000), "convertCash")).toBe(2);
  });
});

describe("convertCashConversion independent literals", () => {
  it("credits half the amount, floored", () => {
    expect(convertCashConversion(100_000)).toBe(50_000);
    expect(convertCashConversion(1_000_000)).toBe(500_000);
    expect(convertCashConversion(999_999)).toBe(499_999);
    expect(convertCashConversion(1)).toBe(0);
    expect(convertCashConversion(0)).toBe(0);
  });
});

describe("calculateConvertCashInfamy independent literals", () => {
  it("matches the historical curve anchors", () => {
    expect(calculateConvertCashInfamy(100_000)).toBe(4);
    expect(calculateConvertCashInfamy(1_000_000)).toBe(15);
    expect(calculateConvertCashInfamy(10_000_000)).toBe(55);
  });
  it("prices nothing at or below zero", () => {
    expect(calculateConvertCashInfamy(0)).toBe(0);
    expect(calculateConvertCashInfamy(-50)).toBe(0);
  });
  it("caps at 100 where the raw curve keeps climbing", () => {
    expect(Math.round(15 * Math.pow(100_000_000 / 1_000_000, 0.564))).toBeGreaterThan(100);
    expect(calculateConvertCashInfamy(100_000_000)).toBe(100);
    expect(calculateConvertCashInfamy(50_000_000)).toBe(100);
  });
});

describe("convert cash quote prices debit and result through one source", () => {
  it("pins the baseline quote ($1M converts to $500K at +15 infamy)", () => {
    expect(quoteConvertCashAction({ amount: 1_000_000 })).toEqual({
      ok: true,
      apCost: 2,
      cashDebitLocal: 1_000_000,
      convertedLocal: 500_000,
      infamy: 15,
    });
  });
  it("floors odd amounts on the credit leg", () => {
    const quote = quoteConvertCashAction({ amount: 999_999 });
    expect(quote).toEqual({
      ok: true,
      apCost: 2,
      cashDebitLocal: 999_999,
      convertedLocal: 499_999,
      infamy: calculateConvertCashInfamy(999_999),
    });
  });
  it("agrees with the conversion and infamy legs at every scale", () => {
    for (const amount of [1, 100_000, 500_000, 1_000_000, 28_000_000, 100_000_000]) {
      const quote = quoteConvertCashAction({ amount });
      expect(quote).toEqual({
        ok: true,
        apCost: CONVERT_CASH_ACTION_COST,
        cashDebitLocal: amount,
        convertedLocal: convertCashConversion(amount),
        infamy: calculateConvertCashInfamy(amount),
      });
    }
  });
});

describe("convert cash quote strictness", () => {
  it("rejects a missing, zero or negative amount with the typed reason", () => {
    for (const actor of [{}, { amount: null }, { amount: 0 }, { amount: -100 }]) {
      const quote = quoteConvertCashAction(actor);
      expect(quote.ok).toBe(false);
      if (quote.ok) continue;
      expect(quote.error).toBe("You must specify an amount to convert.");
    }
  });
  it("rejects non-finite and non-numeric amounts", () => {
    for (const amount of [NaN, Infinity, "500" as unknown as number]) {
      const quote = quoteConvertCashAction({ amount });
      expect(quote.ok).toBe(false);
    }
  });
});

describe("convert cash effect/debit agreement", () => {
  it("the default all-cash effect debits and credits the quoted legs", () => {
    const effect = ACTIONS.convertCash.effect(cashCharacter(500_000));
    expect(effect.cashOnHandChange).toBe(-500_000);
    expect(effect.fundsChange).toBe(convertCashConversion(500_000));
    expect(effect.infamyChange).toBe(calculateConvertCashInfamy(500_000));
    expect(effect.infamyChange).toBe(10);
    expect(effect.message).toContain("+10 Infamy");
  });
  it("a zero home-bucket balance still prices zeros for the funds probe", () => {
    // canPerformAction calls this effect for its funds check after the
    // zero-wealth gate; pricing (not throwing) preserves the legacy probe.
    const effect = ACTIONS.convertCash.effect(cashCharacter(0));
    expect(effect.cashOnHandChange === 0).toBe(true);
    expect(effect.fundsChange).toBe(0);
    expect(effect.infamyChange).toBe(0);
  });
  it("a funded character can perform convertCash", () => {
    expect(canPerformAction(cashCharacter(500_000), "convertCash")).toEqual({
      canPerform: true,
    });
  });
});
