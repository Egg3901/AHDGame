/**
 * Fundraise portable rules (Game1724): single-owner AP cost, yield formula,
 * and donor-level-zero eligibility live in `./rules`. `../actions` re-exports
 * the same names so existing quote/effect callers need no rewrite.
 */
import { describe, it, expect } from "vitest";
import type { Character, State } from "@/lib/db/types";
import type { CharacterStats } from "@/lib/stats/statsConstants";
import { statMultiplier } from "@/lib/stats/statMultiplier";
import { rollDebatePrep } from "../stats/debatePrep";
import {
  DEBATE_PREP_SUCCESS_CHANCE as RESOLVED_DEBATE_CHANCE,
  STAT_MAX,
} from "../stats/statsConstants";
import {
  FUNDRAISE_ACTION_COST,
  FUNDRAISE_NO_DONOR_ERROR,
  calculateFundraisingAmount,
  fundraiseYieldAnchor,
  isFundraiseEligible,
  quoteFundraiseAction,
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
  POLL_BASE_FUND_COST,
  POLL_LARGE_BASE_FUND_COST,
  POLL_ACTION_COST,
  POLL_LARGE_ACTION_COST,
  getPollActionCost,
  getPollBaseFundCost,
  getPollFundCost,
  quotePollAction,
  REST_ACTION_COST,
  REST_RESULT_MESSAGE,
  quoteRestAction,
  DEBATE_PREP_ACTION_COST,
  DEBATE_PREP_SUCCESS_CHANCE,
  DEBATE_PREP_DEBATE_GAIN,
  DEBATE_PREP_DISABLED_ERROR,
  DEBATE_PREP_UNALLOCATED_ERROR,
  quoteDebatePrepAction,
  describeDebatePrepAction,
  describeDebatePrepEffect,
} from "./rules";
import {
  ERA_PRICE_LEVEL,
  eraPriceLevelFor,
  resolveCampaignPriceLevel,
} from "../campaigns/rules/priceLevel";
import {
  ACTIONS,
  buildBatchResultMessage,
  canPerformAction,
  getDonorActionCost,
  getActionPointCost,
  simulateActionBatch,
  type ActionEffectContext,
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
    gdp: 69_618,
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
      { gdpMillions: 69_618, population: 1_000_000, countryId: "US" }
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
    const target = { gdpMillions: 69_618, population: 1_000_000, countryId: "US" };
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
    const target = { gdpMillions: 69_618, population: 1_000_000, countryId: "US" };
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
      { gdpMillions: 69_618, population: 1_000_000, countryId: "US" }
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
      { gdpMillions: 69_618, population: 1_000_000, countryId: "US" }
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
      quoteCampaignAction(actor, { gdpMillions: 69_618, population: 0, countryId: "US" }).ok
    ).toBe(false);
    expect(quoteCampaignAction(actor, { gdpMillions: 69_618, population: 1_000_000 }).ok).toBe(
      false
    );
  });
});
// ── Advertise (Game1724 slice) ──────────────────────────────────────────────
// Average-GDP US home state: gdpPerCapita = 69_618 × 1M / 1M hits the 69_618
// baseline exactly, so the GDP scalar is 1.0 and fund pins read straight off
// the tier multiplier ($100K × (1 + tier × 0.2)).
const AVG_STATE = { gdp: 69_618, population: 1_000_000, name: "Test State" } as State;
const AVG_TARGET = { gdpMillions: 69_618, population: 1_000_000, countryId: "US" };
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
    expect(getAdvertiseFundCost(0, 69_618, 1_000_000)).toBe(100_000);
  });
  it("tier 2 (fav 50) at average GDP costs $140K", () => {
    expect(getAdvertiseFundCost(50, 69_618, 1_000_000)).toBe(140_000);
  });
  it("tier 4 (fav 90) at average GDP costs $180K", () => {
    expect(getAdvertiseFundCost(90, 69_618, 1_000_000)).toBe(180_000);
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
      { gdpMillions: 69_618, population: 1_000_000 }
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
    gdp: 69_618,
    population: 1_000_000,
    countryId: "US",
  } as unknown as State;
}

const DONOR_TARGET = { gdpMillions: 69_618, population: 1_000_000, countryId: "US" };

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
    expect(getBuildDonorBaseFundCost(0, 69_618, 1_000_000)).toBe(3_000);
  });
  it("L10 at average GDP costs $18K", () => {
    expect(getBuildDonorBaseFundCost(10, 69_618, 1_000_000)).toBe(18_000);
  });
  it("L50 at average GDP costs $78K", () => {
    expect(getBuildDonorBaseFundCost(50, 69_618, 1_000_000)).toBe(78_000);
  });
  it("L75 at average GDP costs $116K", () => {
    expect(getBuildDonorBaseFundCost(75, 69_618, 1_000_000)).toBe(116_000);
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

// ── GDP-baseline preset parity (issue #798) ───────────────────────────────────
// The actions page passes `worldFlags.preset` into the three GDP-scaled quotes
// and the execute shell passes `gameState.preset` into validation and effect,
// so a historical-world quote and its execution share one (country, era)
// baseline. The tests below prove the preset is load-bearing in every quote
// and that quote, effect and validation agree when it is threaded. A CN
// 1953-scale region is the fixture: per-capita 57 USD-anchored resolves a
// neutral scalar under its own era but pins to the 0.85 floor under the modern
// default, so omitting the preset visibly misprices the quote.
const CN_1953_POP = 10_000_000;
const CN_1953_GDP_MILLIONS = (57 * CN_1953_POP) / 1_000_000;

function cn1953State(): State {
  return {
    name: "CN Test Region",
    gdp: CN_1953_GDP_MILLIONS,
    population: CN_1953_POP,
    countryId: "CN",
  } as unknown as State;
}

function cn1953Target(preset?: string) {
  return {
    gdpMillions: CN_1953_GDP_MILLIONS,
    population: CN_1953_POP,
    countryId: "CN",
    preset,
  };
}

// Effect context for preset-parity checks: the assertions compare debited
// ANCHOR units, never the rendered message, so the formatter is the same
// bare-number fallback canPerformAction uses for non-rendering callers.
function presetEffectCtx(preset: "1953-default" | undefined): ActionEffectContext {
  return {
    preset,
    formatFunds: (anchor) => Math.round(anchor).toLocaleString(),
  };
}

describe("GDP-baseline preset is load-bearing in every GDP-scaled quote", () => {
  it("campaign quotes the era baseline when preset is threaded, the modern floor when omitted", () => {
    const actor = { politicalInfluence: 0, charisma: 5.5, intellect: 5.5 };
    const eraQuote = quoteCampaignAction(actor, cn1953Target("1953-default"));
    const defaultQuote = quoteCampaignAction(actor, cn1953Target());
    expect(eraQuote.ok && defaultQuote.ok).toBe(true);
    if (!eraQuote.ok || !defaultQuote.ok) return;
    // Neutral scalar under the 1953 baseline vs the 0.85 clamp under modern.
    expect(eraQuote.fundCostAnchor).toBe(20_000);
    expect(defaultQuote.fundCostAnchor).toBe(17_000);
    expect(eraQuote.fundCostAnchor).toBeGreaterThan(defaultQuote.fundCostAnchor);
    // The quote applies the cost function with the same preset, not a copy.
    expect(eraQuote.fundCostAnchor).toBe(
      Math.round(
        getCampaignFundCost(0, CN_1953_GDP_MILLIONS, CN_1953_POP, "CN", "1953-default") /
          statMultiplier(5.5)
      )
    );
  });
  it("advertise quotes the era baseline when preset is threaded, the modern floor when omitted", () => {
    const actor = { favorability: 0, charisma: 5.5 };
    const eraQuote = quoteAdvertiseAction(actor, cn1953Target("1953-default"));
    const defaultQuote = quoteAdvertiseAction(actor, cn1953Target());
    expect(eraQuote.ok && defaultQuote.ok).toBe(true);
    if (!eraQuote.ok || !defaultQuote.ok) return;
    expect(eraQuote.fundCostAnchor).toBe(100_000);
    expect(defaultQuote.fundCostAnchor).toBe(85_000);
    expect(eraQuote.fundCostAnchor).toBe(
      getAdvertiseFundCost(0, CN_1953_GDP_MILLIONS, CN_1953_POP, "CN", "1953-default")
    );
  });
  it("buildDonorBase quotes the era baseline when preset is threaded, the modern floor when omitted", () => {
    const actor = { donorBaseLevel: 10, fundraising: 5.5 };
    const eraQuote = quoteBuildDonorBaseAction(actor, cn1953Target("1953-default"));
    const defaultQuote = quoteBuildDonorBaseAction(actor, cn1953Target());
    expect(eraQuote.ok && defaultQuote.ok).toBe(true);
    if (!eraQuote.ok || !defaultQuote.ok) return;
    expect(eraQuote.fundCostAnchor).toBe(18_000);
    expect(defaultQuote.fundCostAnchor).toBe(15_000);
    expect(eraQuote.fundCostAnchor).toBe(
      Math.round(
        getBuildDonorBaseFundCost(10, CN_1953_GDP_MILLIONS, CN_1953_POP, "CN", "1953-default") /
          statMultiplier(5.5)
      )
    );
  });
});

describe("GDP-baseline preset parity between UI quote and execution", () => {
  it("campaign effect debits exactly what the same-preset quote advertises", () => {
    const state = cn1953State();
    for (const preset of ["1953-default", undefined] as const) {
      const quote = quoteCampaignAction(
        { politicalInfluence: 0, charisma: 5.5, intellect: 5.5 },
        cn1953Target(preset)
      );
      expect(quote.ok).toBe(true);
      if (!quote.ok) continue;
      const char = campaignCharacter(0, 5.5, 5.5, { countryId: "CN" });
      const effect = ACTIONS.campaign.effect(char, state, presetEffectCtx(preset));
      expect(effect.fundsChange).toBe(-quote.fundCostAnchor);
      expect(effect.politicalInfluenceChange).toBe(quote.influenceGain);
    }
  });
  it("advertise effect debits exactly what the same-preset quote advertises", () => {
    const state = cn1953State();
    for (const preset of ["1953-default", undefined] as const) {
      const quote = quoteAdvertiseAction({ favorability: 0, charisma: 5.5 }, cn1953Target(preset));
      expect(quote.ok).toBe(true);
      if (!quote.ok) continue;
      const char = makeCharacter({
        actions: 100,
        funds: 100_000_000,
        favorability: 0,
        countryId: "CN",
        stats: { ...NEUTRAL_STATS, charisma: 5.5 },
      });
      const effect = ACTIONS.advertise.effect(char, state, presetEffectCtx(preset));
      expect(effect.fundsChange).toBe(-quote.fundCostAnchor);
      expect(effect.favorabilityChange).toBe(quote.favorabilityGain);
    }
  });
  it("buildDonorBase effect debits exactly what the same-preset quote advertises", () => {
    const state = cn1953State();
    for (const preset of ["1953-default", undefined] as const) {
      const quote = quoteBuildDonorBaseAction(
        { donorBaseLevel: 10, fundraising: 5.5 },
        cn1953Target(preset)
      );
      expect(quote.ok).toBe(true);
      if (!quote.ok) continue;
      const char = donorCharacter(10, 5.5, { countryId: "CN" });
      const effect = ACTIONS.buildDonorBase.effect(char, state, presetEffectCtx(preset));
      expect(effect.fundsChange).toBe(-quote.fundCostAnchor);
      expect(effect.donorBaseLevelChange).toBe(quote.donorGain);
    }
  });
  it("validation enforces the preset-threaded cost, not the omitted-preset quote", () => {
    // Regression for the actions-page omission: the page quoted the modern
    // floor (17,000) while the server charged the era cost (20,000), so a
    // player quoted "affordable" failed at execution. With the preset threaded
    // on both sides, a balance covering only the modern quote fails validation
    // under the era preset and passes without it.
    const state = cn1953State();
    const poor = campaignCharacter(0, 5.5, 5.5, { countryId: "CN", funds: 17_000 });
    expect(canPerformAction(poor, "campaign", state)).toEqual({ canPerform: true });
    expect(canPerformAction(poor, "campaign", state, { preset: "1953-default" })).toEqual({
      canPerform: false,
      reason: expect.stringContaining("Not enough funds"),
    });
    const rich = campaignCharacter(0, 5.5, 5.5, { countryId: "CN", funds: 20_000 });
    expect(canPerformAction(rich, "campaign", state, { preset: "1953-default" })).toEqual({
      canPerform: true,
    });
  });
});

describe("GDP-baseline preset failure agreement", () => {
  it("all three GDP-scaled quotes fail loudly for countries without a baseline", () => {
    expect(() =>
      quoteCampaignAction(
        { politicalInfluence: 0, charisma: 5.5, intellect: 5.5 },
        { gdpMillions: 100_000, population: 1_000_000, countryId: "XX", preset: "1953-default" }
      )
    ).toThrow(/no GDP baseline/);
    expect(() =>
      quoteAdvertiseAction(
        { favorability: 0, charisma: 5.5 },
        { gdpMillions: 100_000, population: 1_000_000, countryId: "BR", preset: "1953-default" }
      )
    ).toThrow(/no GDP baseline/);
    expect(() =>
      quoteBuildDonorBaseAction(
        { donorBaseLevel: 0, fundraising: 5.5 },
        { gdpMillions: 100_000, population: 1_000_000, countryId: "XX" }
      )
    ).toThrow(/no GDP baseline/);
  });
});

// ── Poll (Game1724 slice) ───────────────────────────────────────────────────
// quotePollAction owns the flat AP cost and the intellect-scaled fund cost.
// The poll API route (GET quote and affordability, POST atomic debit), the
// poll page display, getActionPointCost (debit), the action effect (result)
// and canPerformAction (failure) all route through it, so the numbers below
// prove agreement instead of re-stating the formula.

function pollCharacter(intellect?: number | null): Character {
  return makeCharacter({
    actions: 100,
    funds: 100_000_000,
    stats: intellect === null ? undefined : ({ intellect: intellect ?? 5.5 } as Character["stats"]),
  });
}

describe("poll base costs are single-sourced", () => {
  it("pins the $25K/$75K bases the intellect hook scales", () => {
    expect(POLL_BASE_FUND_COST).toBe(25_000);
    expect(POLL_LARGE_BASE_FUND_COST).toBe(75_000);
    expect(getPollBaseFundCost("small")).toBe(25_000);
    expect(getPollBaseFundCost("large")).toBe(75_000);
  });
  it("pins the flat 2/6 AP costs across the rules and the debit path", () => {
    expect(POLL_ACTION_COST).toBe(2);
    expect(POLL_LARGE_ACTION_COST).toBe(6);
    expect(getPollActionCost("small")).toBe(2);
    expect(getPollActionCost("large")).toBe(6);
    expect(ACTIONS.poll.baseCost).toBe(2);
    expect(ACTIONS.pollLarge.baseCost).toBe(6);
    expect(getActionPointCost(pollCharacter(), "poll")).toBe(2);
    expect(getActionPointCost(pollCharacter(), "pollLarge")).toBe(6);
  });
});

describe("getPollFundCost independent literals", () => {
  it("neutral intellect pays the unscaled base", () => {
    expect(getPollFundCost("small", 5.5)).toBe(25_000);
    expect(getPollFundCost("large", 5.5)).toBe(75_000);
  });
  it("low intellect pays more (stat 1 → 0.82x divisor)", () => {
    expect(getPollFundCost("small", 1)).toBe(30_488);
    expect(getPollFundCost("large", 1)).toBe(91_463);
  });
  it("high intellect pays less (stat 10 → 1.18x divisor)", () => {
    expect(getPollFundCost("small", 10)).toBe(21_186);
    expect(getPollFundCost("large", 10)).toBe(63_559);
  });
});

describe("poll quote matches debit and result through one source", () => {
  it("pins the baseline quotes (neutral intellect)", () => {
    expect(quotePollAction({ intellect: 5.5 }, "small")).toEqual({
      ok: true,
      apCost: 2,
      fundCostAnchor: 25_000,
    });
    expect(quotePollAction({ intellect: 5.5 }, "large")).toEqual({
      ok: true,
      apCost: 6,
      fundCostAnchor: 75_000,
    });
  });
  it("quote, AP debit and effect result agree across tiers and intellects", () => {
    for (const tier of ["small", "large"] as const) {
      const actionKey = tier === "large" ? "pollLarge" : "poll";
      for (const intellect of [1, 5.5, 10]) {
        const char = pollCharacter(intellect);
        const quote = quotePollAction({ intellect }, tier);
        expect(quote.ok).toBe(true);
        if (!quote.ok) continue;
        // Debit side: AP cost and the effect result carry the same numbers.
        expect(getActionPointCost(char, actionKey)).toBe(quote.apCost);
        expect(ACTIONS[actionKey].effect(char).fundsChange).toBe(-quote.fundCostAnchor);
        // The quote itself applies the historical math, not a copy of it.
        expect(quote.apCost).toBe(getPollActionCost(tier));
        expect(quote.fundCostAnchor).toBe(getPollFundCost(tier, intellect));
      }
    }
  });
  it("a test-only intellect bump moves quote, AP debit and effect together", () => {
    // One base input changes (intellect 1 -> 10); both the displayed quote
    // and the debited/applied result must follow it through the same
    // function, with no second formula edit.
    const weak = quotePollAction({ intellect: 1 }, "small");
    const strong = quotePollAction({ intellect: 10 }, "small");
    expect(weak.ok && strong.ok).toBe(true);
    if (!weak.ok || !strong.ok) return;
    expect(strong.fundCostAnchor).toBeLessThan(weak.fundCostAnchor);
    expect(getActionPointCost(pollCharacter(10), "poll")).toBe(strong.apCost);
    expect(ACTIONS.poll.effect(pollCharacter(1)).fundsChange).toBe(-weak.fundCostAnchor);
    expect(ACTIONS.poll.effect(pollCharacter(10)).fundsChange).toBe(-strong.fundCostAnchor);
    const large = quotePollAction({ intellect: 10 }, "large");
    expect(large.ok).toBe(true);
    if (!large.ok) return;
    expect(ACTIONS.pollLarge.effect(pollCharacter(10)).fundsChange).toBe(-large.fundCostAnchor);
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
      quoteBuildDonorBaseAction(actor, { gdpMillions: 69_618, population: 0, countryId: "US" }).ok
    ).toBe(false);
    expect(
      quoteBuildDonorBaseAction(actor, { gdpMillions: 69_618, population: 1_000_000 }).ok
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

describe("poll failure agreement", () => {
  it("missing intellect rejects quote, validation and batch with one reason", () => {
    const reason =
      "Polling requires an allocated intellect stat. Allocate your stats before commissioning a poll.";
    for (const tier of ["small", "large"] as const) {
      expect(quotePollAction({}, tier)).toEqual({ ok: false, error: reason });
      expect(quotePollAction({ intellect: null }, tier)).toEqual({ ok: false, error: reason });
      expect(quotePollAction({ intellect: NaN }, tier)).toEqual({ ok: false, error: reason });
    }
    const noStats = pollCharacter(null);
    expect(canPerformAction(noStats, "poll")).toEqual({ canPerform: false, reason });
    expect(canPerformAction(noStats, "pollLarge")).toEqual({ canPerform: false, reason });
    expect(simulateActionBatch(noStats, undefined, "poll", 5)).toEqual({
      ok: false,
      reason,
    });
    expect(simulateActionBatch(noStats, undefined, "pollLarge", 5)).toEqual({
      ok: false,
      reason,
    });
  });
  it("validation passes and batch simulates for an allocated intellect", () => {
    const char = pollCharacter(5.5);
    expect(canPerformAction(char, "poll")).toEqual({ canPerform: true });
    expect(canPerformAction(char, "pollLarge")).toEqual({ canPerform: true });
    const batch = simulateActionBatch(char, undefined, "poll", 5);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.totalActionPoints).toBe(10);
    expect(batch.netFundsChange).toBe(-125_000);
  });
});

describe("rest quote agreement", () => {
  it("rest is always free and always quotable", () => {
    expect(REST_ACTION_COST).toBe(0);
    expect(quoteRestAction()).toEqual({ ok: true, apCost: 0, fundCostAnchor: 0 });
  });
  it("effect, validation and AP cost agree on zero cost", () => {
    expect(ACTIONS.rest.baseCost).toBe(REST_ACTION_COST);
    expect(ACTIONS.rest.effect(makeCharacter({ actions: 0, funds: 0 }))).toEqual({
      message: REST_RESULT_MESSAGE,
    });
    expect(getActionPointCost(makeCharacter({}), "rest")).toBe(0);
    // A fully spent, broke character can always rest: no AP gate, no funds
    // gate, no state requirement.
    expect(canPerformAction(makeCharacter({ actions: 0, funds: 0 }), "rest")).toEqual({
      canPerform: true,
    });
  });
  it("batch rest charges no AP, moves no funds and reports the single message", () => {
    const char = makeCharacter({
      actions: 3,
      funds: 500_000,
      politicalInfluence: 10,
      favorability: 20,
    });
    const batch = simulateActionBatch(char, undefined, "rest", 5);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.totalActionPoints).toBe(0);
    expect(batch.netFundsChange).toBe(0);
    expect(batch.finalCharacter.actions).toBe(3);
    expect(batch.finalCharacter.funds).toBe(500_000);
    expect(batch.finalCharacter.politicalInfluence).toBe(10);
    // Every delta is zero, so the batch message falls back to the single-run
    // message from the shared effect.
    expect(buildBatchResultMessage(5, char, batch.finalCharacter, REST_RESULT_MESSAGE, "USD")).toBe(
      `Completed 5 times. ${REST_RESULT_MESSAGE}`
    );
  });
});
// ── Fundraise (Game1724 slice) ──────────────────────────────────────────────
// quoteFundraiseAction owns the flat AP cost, the stat-scaled yield and the
// donor-base eligibility. The action effect (result), canPerformAction
// (failure), the UI card, the batch simulator and the AI advisor all route
// through it, so the numbers below prove agreement instead of re-stating the
// formula.

function fundraiseCharacter(
  donorBaseLevel: number | null | undefined,
  fundraising?: number | null,
  overrides: Partial<Character> = {}
): Character {
  return makeCharacter({
    actions: 100,
    funds: 1_000_000,
    donorBaseLevel: donorBaseLevel ?? 0,
    politicalInfluence: 40,
    ...(fundraising === undefined
      ? { stats: undefined }
      : { stats: { fundraising } as Character["stats"] }),
    ...overrides,
  });
}

describe("quoteFundraiseAction happy path", () => {
  it("quotes flat AP and the shared stat-scaled yield", () => {
    for (const [level, influence, fundraising] of [
      [10, 0, undefined],
      [50, 40, undefined],
      [50, 40, 10],
      [50, 40, 1],
      [75, 100, 5.5],
    ] as const) {
      const quote = quoteFundraiseAction({
        donorBaseLevel: level,
        politicalInfluence: influence,
        fundraising,
      });
      expect(quote.ok).toBe(true);
      if (!quote.ok) continue;
      expect(quote.apCost).toBe(FUNDRAISE_ACTION_COST);
      expect(quote.yieldAnchor).toBe(
        fundraiseYieldAnchor({
          donorBaseLevel: level,
          politicalInfluence: influence,
          stats: fundraising == null ? undefined : { fundraising },
        })
      );
    }
  });
  it("missing influence and stats keep the historical neutral fallbacks", () => {
    expect(quoteFundraiseAction({ donorBaseLevel: 50 })).toEqual({
      ok: true,
      apCost: 3,
      yieldAnchor: 150_000,
    });
  });
  it("the quoted AP matches every charger", () => {
    const quote = quoteFundraiseAction({ donorBaseLevel: 10 });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.apCost).toBe(ACTIONS.fundraise.baseCost);
    expect(quote.apCost).toBe(getDonorActionCost(10, "fundraise"));
    expect(getActionPointCost(fundraiseCharacter(10), "fundraise")).toBe(quote.apCost);
  });
});

describe("quoteFundraiseAction strictness", () => {
  it("pins the execute-gate rejection string as an independent literal", () => {
    expect(FUNDRAISE_NO_DONOR_ERROR).toBe(
      "You have no donor base. Use 'Build Donor Network' first to establish one before fundraising."
    );
  });
  it("a zero donor base rejects instead of pricing an unearned yield", () => {
    for (const donorBaseLevel of [0, null, undefined]) {
      expect(quoteFundraiseAction({ donorBaseLevel })).toEqual({
        ok: false,
        error: FUNDRAISE_NO_DONOR_ERROR,
      });
    }
  });
});

describe("fundraise effect parity", () => {
  it("the effect credits exactly the quoted yield", () => {
    for (const fundraising of [undefined, 1, 5.5, 10]) {
      const char = fundraiseCharacter(50, fundraising);
      const quote = quoteFundraiseAction({
        donorBaseLevel: 50,
        politicalInfluence: 40,
        fundraising,
      });
      expect(quote.ok).toBe(true);
      if (!quote.ok) continue;
      const effect = ACTIONS.fundraise.effect(char);
      expect(effect.fundsChange).toBe(quote.yieldAnchor);
      expect(effect.message).toContain(Math.round(quote.yieldAnchor).toLocaleString());
    }
  });
  it("the effect throws the quote reason for a zero donor base", () => {
    expect(() => ACTIONS.fundraise.effect(fundraiseCharacter(0))).toThrow(FUNDRAISE_NO_DONOR_ERROR);
  });
});

describe("fundraise failure agreement", () => {
  it("zero donor base rejects quote, validation and batch with one reason", () => {
    const reason = FUNDRAISE_NO_DONOR_ERROR;
    expect(quoteFundraiseAction({ donorBaseLevel: 0 })).toEqual({ ok: false, error: reason });
    const noDonors = fundraiseCharacter(0);
    expect(canPerformAction(noDonors, "fundraise")).toEqual({ canPerform: false, reason });
    expect(simulateActionBatch(noDonors, undefined, "fundraise", 5)).toEqual({
      ok: false,
      reason,
    });
  });
  it("validation passes and batch simulates at the quoted yield", () => {
    const char = fundraiseCharacter(50, 10);
    expect(canPerformAction(char, "fundraise")).toEqual({ canPerform: true });
    const quote = quoteFundraiseAction({
      donorBaseLevel: 50,
      politicalInfluence: 40,
      fundraising: 10,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    const batch = simulateActionBatch(char, undefined, "fundraise", 5);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.totalActionPoints).toBe(5 * FUNDRAISE_ACTION_COST);
    expect(batch.netFundsChange).toBe(5 * quote.yieldAnchor);
  });
});

function debateCharacter(debate: number | null): Character {
  return makeCharacter({
    stats: debate === null ? undefined : ({ debate } as Character["stats"]),
  });
}

describe("debate prep cost is single-sourced", () => {
  it("costs a flat 1 AP through the constant, the definition and the charger", () => {
    expect(DEBATE_PREP_ACTION_COST).toBe(1);
    expect(ACTIONS.debatePrep.baseCost).toBe(DEBATE_PREP_ACTION_COST);
    expect(getActionPointCost(debateCharacter(5), "debatePrep")).toBe(DEBATE_PREP_ACTION_COST);
    const quote = quoteDebatePrepAction({ debate: 5, hasStats: true });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.apCost).toBe(DEBATE_PREP_ACTION_COST);
  });
});

describe("quoteDebatePrepAction happy path", () => {
  it("quotes flat AP, the fixed chance and +1 gain", () => {
    for (const debate of [0, 1, 5, 9]) {
      const quote = quoteDebatePrepAction({ debate, hasStats: true });
      expect(quote).toEqual({
        ok: true,
        apCost: 1,
        successChance: 0.15,
        debateGain: 1,
        capped: false,
      });
    }
  });
  it("an explicit enabled flag and an omitted flag both skip the flag leg", () => {
    for (const options of [undefined, {}, { rpgStatsEnabled: true }]) {
      const quote = quoteDebatePrepAction({ debate: 5, hasStats: true }, options);
      expect(quote.ok).toBe(true);
    }
  });
  it("the quoted chance is the constant the roll resolves against", () => {
    expect(DEBATE_PREP_SUCCESS_CHANCE).toBe(0.15);
    expect(DEBATE_PREP_SUCCESS_CHANCE).toBe(RESOLVED_DEBATE_CHANCE);
    expect(DEBATE_PREP_DEBATE_GAIN).toBe(1);
  });
});

describe("quoteDebatePrepAction strictness", () => {
  it("pins the execute-gate rejection strings as independent literals", () => {
    expect(DEBATE_PREP_DISABLED_ERROR).toBe("The stat system is not currently enabled.");
    expect(DEBATE_PREP_UNALLOCATED_ERROR).toBe("Allocate your stats before using Debate Prep.");
  });
  it("a disabled flag rejects before the stat check, mirroring gate order", () => {
    expect(
      quoteDebatePrepAction({ debate: 5, hasStats: true }, { rpgStatsEnabled: false })
    ).toEqual({ ok: false, error: DEBATE_PREP_DISABLED_ERROR });
    expect(quoteDebatePrepAction({}, { rpgStatsEnabled: false })).toEqual({
      ok: false,
      error: DEBATE_PREP_DISABLED_ERROR,
    });
  });
  it("a missing stat block or debate rejects with the allocate reason", () => {
    for (const actor of [
      {},
      { hasStats: false },
      { hasStats: false, debate: 5 },
      { hasStats: true },
      { hasStats: true, debate: null },
      { hasStats: true, debate: NaN },
      { hasStats: true, debate: Infinity },
    ]) {
      expect(quoteDebatePrepAction(actor)).toEqual({
        ok: false,
        error: DEBATE_PREP_UNALLOCATED_ERROR,
      });
    }
  });
});

describe("quoteDebatePrepAction cap", () => {
  it("at-cap attempts stay quotable with zero gain (execution still charges)", () => {
    for (const debate of [STAT_MAX, STAT_MAX + 1]) {
      expect(quoteDebatePrepAction({ debate, hasStats: true })).toEqual({
        ok: true,
        apCost: 1,
        successChance: 0.15,
        debateGain: 0,
        capped: true,
      });
    }
  });
  it("one below the cap still gains, and negatives quote without validation", () => {
    expect(quoteDebatePrepAction({ debate: STAT_MAX - 1, hasStats: true })).toEqual({
      ok: true,
      apCost: 1,
      successChance: 0.15,
      debateGain: 1,
      capped: false,
    });
    const negative = quoteDebatePrepAction({ debate: -2, hasStats: true });
    expect(negative).toEqual({
      ok: true,
      apCost: 1,
      successChance: 0.15,
      debateGain: 1,
      capped: false,
    });
  });
});

describe("advertised debate odds match the resolved roll", () => {
  it("the roll succeeds just under the quoted chance and fails on it", () => {
    const quote = quoteDebatePrepAction({ debate: 5, hasStats: true });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(rollDebatePrep(() => quote.successChance - 1e-9, 5)).toEqual({
      success: true,
      debate: 6,
    });
    expect(rollDebatePrep(() => quote.successChance, 5)).toEqual({
      success: false,
      debate: 5,
    });
  });
  it("a successful roll at the cap clamps, matching the zero-gain quote", () => {
    expect(rollDebatePrep(() => 0, STAT_MAX)).toEqual({ success: true, debate: STAT_MAX });
  });
  it("definition and card text derive the resolved chance, not a stale literal", () => {
    expect(describeDebatePrepEffect()).toBe("15% chance: +1 Debate");
    expect(ACTIONS.debatePrep.description).toBe(describeDebatePrepAction());
    expect(ACTIONS.debatePrep.description).toContain("15% chance");
    expect(ACTIONS.debatePrep.description).not.toContain("10%");
    expect(describeDebatePrepEffect()).not.toContain("10%");
  });
});

describe("debate prep failure agreement", () => {
  it("missing stats reject quote, validation and batch with one reason", () => {
    const reason = DEBATE_PREP_UNALLOCATED_ERROR;
    expect(quoteDebatePrepAction({})).toEqual({ ok: false, error: reason });
    const noStats = debateCharacter(null);
    expect(canPerformAction(noStats, "debatePrep")).toEqual({ canPerform: false, reason });
    expect(simulateActionBatch(noStats, undefined, "debatePrep", 5)).toEqual({
      ok: false,
      reason,
    });
  });
  it("a resolved-disabled flag rejects validation with the gate reason", () => {
    expect(
      canPerformAction(debateCharacter(5), "debatePrep", undefined, { rpgStatsEnabled: false })
    ).toEqual({ canPerform: false, reason: DEBATE_PREP_DISABLED_ERROR });
  });
  it("validation passes and batch simulates for allocated stats", () => {
    const char = debateCharacter(5);
    expect(canPerformAction(char, "debatePrep")).toEqual({ canPerform: true });
    const batch = simulateActionBatch(char, undefined, "debatePrep", 5);
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    expect(batch.totalActionPoints).toBe(5);
    expect(batch.netFundsChange).toBe(0);
  });
  it("a capped character still validates (execution charges the AP)", () => {
    expect(canPerformAction(debateCharacter(STAT_MAX), "debatePrep")).toEqual({
      canPerform: true,
    });
  });
});

// ── Era price level (issue #2119) ────────────────────────────────────────────
// Every money quote/helper takes a trailing `priceLevel` scalar, resolved at the
// shell from `gameConfig.campaignEraPriceLevelEnabled` + `gameState.preset`.
// These tests prove: (1) flag OFF resolves exactly 1 and reproduces every
// existing pin byte-for-byte, (2) flag ON scales a 1953 cost and a 1953 income
// by the SAME era value (symmetry), and (3) 2019 is unchanged.
describe("era price level threading (issue #2119)", () => {
  // Era-neutral US 1953 region: per-capita == the 1953 US baseline (2,557), so
  // the within-era GDP scalar is exactly 1 and any movement is the price level.
  const US_1953 = { gdpMillions: 2_557, population: 1_000_000, countryId: "US" } as const;
  const P1953 = eraPriceLevelFor("1953-default");

  it("flag off resolves exactly 1 for every preset (zero behavior change)", () => {
    for (const enabled of [false, undefined, null]) {
      for (const preset of ["1953-default", "1991-default", "2019-default", undefined]) {
        expect(resolveCampaignPriceLevel(enabled, preset)).toBe(1);
      }
    }
  });

  it("flag off leaves every helper and quote identical to its omitted-scalar call", () => {
    const target = { gdpMillions: 69_618, population: 1_000_000, countryId: "US" };
    // Low-level helpers: passing the flag-off scalar (1) is the same expression.
    expect(getCampaignFundCost(0, 69_618, 1_000_000, "US", undefined, 1)).toBe(
      getCampaignFundCost(0, 69_618, 1_000_000)
    );
    expect(getCampaignFundCost(0, 2_557, 1_000_000, "US", "1953-default", 1)).toBe(
      getCampaignFundCost(0, 2_557, 1_000_000, "US", "1953-default")
    );
    expect(getAdvertiseFundCost(50, 69_618, 1_000_000, "US", undefined, 1)).toBe(
      getAdvertiseFundCost(50, 69_618, 1_000_000)
    );
    expect(getBuildDonorBaseFundCost(50, 69_618, 1_000_000, "US", undefined, 1)).toBe(
      getBuildDonorBaseFundCost(50, 69_618, 1_000_000)
    );
    expect(getPollFundCost("small", 1, 1)).toBe(getPollFundCost("small", 1));
    expect(calculateFundraisingAmount(50, 50, 1)).toBe(calculateFundraisingAmount(50, 50));
    expect(fundraiseYieldAnchor({ donorBaseLevel: 50, politicalInfluence: 40 }, 1)).toBe(
      fundraiseYieldAnchor({ donorBaseLevel: 50, politicalInfluence: 40 })
    );
    // Strict quotes: the flag-off scalar is a no-op against the pinned literals.
    expect(
      quoteCampaignAction({ politicalInfluence: 0, charisma: 5.5, intellect: 5.5 }, target, 1)
    ).toEqual(
      quoteCampaignAction({ politicalInfluence: 0, charisma: 5.5, intellect: 5.5 }, target)
    );
    expect(quoteAdvertiseAction({ favorability: 0, charisma: 5.5 }, target, 1)).toEqual(
      quoteAdvertiseAction({ favorability: 0, charisma: 5.5 }, target)
    );
    expect(quoteBuildDonorBaseAction({ donorBaseLevel: 0, fundraising: 5.5 }, target, 1)).toEqual(
      quoteBuildDonorBaseAction({ donorBaseLevel: 0, fundraising: 5.5 }, target)
    );
    expect(quoteFundraiseAction({ donorBaseLevel: 50, politicalInfluence: 40 }, 1)).toEqual(
      quoteFundraiseAction({ donorBaseLevel: 50, politicalInfluence: 40 })
    );
    expect(quotePollAction({ intellect: 5.5 }, "small", 1)).toEqual(
      quotePollAction({ intellect: 5.5 }, "small")
    );
    // The pinned literal itself is untouched.
    expect(
      quoteCampaignAction({ politicalInfluence: 0, charisma: 5.5, intellect: 5.5 }, target)
    ).toEqual({ ok: true, apCost: 1, fundCostAnchor: 20_000, influenceGain: 1 });
  });

  it("flag on scales a 1953 cost and a 1953 income by the SAME era price level", () => {
    expect(resolveCampaignPriceLevel(true, "1953-default")).toBe(P1953);
    expect(P1953).toBe(ERA_PRICE_LEVEL["1953"]);
    expect(P1953).toBeGreaterThan(0);
    expect(P1953).toBeLessThan(1);

    // Cost side: modern base deflated once by the era price level.
    const modernCampaign = getCampaignFundCost(0, 2_557, 1_000_000, "US", "1953-default");
    const eraCampaign = getCampaignFundCost(0, 2_557, 1_000_000, "US", "1953-default", P1953);
    expect(modernCampaign).toBe(20_000);
    expect(eraCampaign).toBe(Math.round((20_000 * P1953) / 1_000) * 1_000);
    expect(eraCampaign).toBeLessThan(modernCampaign);

    const modernAdvertise = getAdvertiseFundCost(0, 2_557, 1_000_000, "US", "1953-default");
    const eraAdvertise = getAdvertiseFundCost(0, 2_557, 1_000_000, "US", "1953-default", P1953);
    expect(modernAdvertise).toBe(100_000);
    expect(eraAdvertise).toBe(Math.round((100_000 * P1953) / 1_000) * 1_000);

    // Income side: the fundraise L0 yield ($50K base) deflates by the SAME value.
    const modernYield = fundraiseYieldAnchor({ donorBaseLevel: 0, politicalInfluence: 0 });
    const eraYield = fundraiseYieldAnchor({ donorBaseLevel: 0, politicalInfluence: 0 }, P1953);
    expect(modernYield).toBe(50_000);
    expect(eraYield).toBe(Math.round(50_000 * P1953));
    expect(eraYield).toBeLessThan(modernYield);
  });

  it("flag on scales the strict quotes by the same era value as the helpers", () => {
    const actor = { politicalInfluence: 0, charisma: 5.5, intellect: 5.5 };
    const qModern = quoteCampaignAction(actor, { ...US_1953, preset: "1953-default" });
    const qEra = quoteCampaignAction(actor, { ...US_1953, preset: "1953-default" }, P1953);
    expect(qModern.ok && qEra.ok).toBe(true);
    if (!qModern.ok || !qEra.ok) return;
    expect(qModern.fundCostAnchor).toBe(20_000);
    expect(qEra.fundCostAnchor).toBe(Math.round((20_000 * P1953) / 1_000) * 1_000);

    const yieldQuote = quoteFundraiseAction({ donorBaseLevel: 50, politicalInfluence: 0 }, P1953);
    expect(yieldQuote.ok).toBe(true);
    if (!yieldQuote.ok) return;
    // L50 / 0% influence: the $150K base deflated by the same era value.
    expect(yieldQuote.yieldAnchor).toBe(Math.round(150_000 * P1953));
  });

  it("2019 stays unchanged even with the flag on", () => {
    const p = resolveCampaignPriceLevel(true, "2019-default");
    expect(p).toBe(1);
    expect(getCampaignFundCost(0, 69_618, 1_000_000, "US", "2019-default", p)).toBe(
      getCampaignFundCost(0, 69_618, 1_000_000, "US", "2019-default")
    );
    expect(fundraiseYieldAnchor({ donorBaseLevel: 50, politicalInfluence: 40 }, p)).toBe(
      fundraiseYieldAnchor({ donorBaseLevel: 50, politicalInfluence: 40 })
    );
    expect(
      quoteCampaignAction(
        { politicalInfluence: 0, charisma: 5.5, intellect: 5.5 },
        {
          gdpMillions: 69_618,
          population: 1_000_000,
          countryId: "US",
          preset: "2019-default",
        },
        p
      )
    ).toEqual(
      quoteCampaignAction(
        { politicalInfluence: 0, charisma: 5.5, intellect: 5.5 },
        { gdpMillions: 69_618, population: 1_000_000, countryId: "US", preset: "2019-default" }
      )
    );
  });
});
