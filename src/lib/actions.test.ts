import { describe, it, expect } from "vitest";
import type { Character, State } from "@/lib/db/types";
import {
  calculateInfluenceAccrual,
  getCampaignActionCost,
  getAdvertiseActionCost,
  getDonorActionCost,
  getFundMultiplier,
  canPerformAction,
  ACTIONS,
  buildBatchResultMessage,
  type ActionEffectContext,
} from "./actions";

describe("calculateInfluenceAccrual", () => {
  it("always returns 0.5 regardless of current NPI", () => {
    expect(calculateInfluenceAccrual(0)).toBe(0.5);
    expect(calculateInfluenceAccrual(50)).toBe(0.5);
    expect(calculateInfluenceAccrual(100)).toBe(0.5);
    expect(calculateInfluenceAccrual(500)).toBe(0.5);
  });
});

describe("getAdvertiseActionCost", () => {
  it("returns base cost 5 at low favorability", () => {
    expect(getAdvertiseActionCost(0)).toBe(5);
    expect(getAdvertiseActionCost(29)).toBe(5);
  });
  it("returns 6 at tier 1 (30-49)", () => {
    expect(getAdvertiseActionCost(30)).toBe(6);
    expect(getAdvertiseActionCost(49)).toBe(6);
  });
  it("returns 7 at tier 2 (50-69)", () => {
    expect(getAdvertiseActionCost(50)).toBe(7);
    expect(getAdvertiseActionCost(69)).toBe(7);
  });
  it("returns 8 at tier 3 (70-84)", () => {
    expect(getAdvertiseActionCost(70)).toBe(8);
    expect(getAdvertiseActionCost(84)).toBe(8);
  });
  it("returns 9 at tier 4 (85-100)", () => {
    expect(getAdvertiseActionCost(85)).toBe(9);
    expect(getAdvertiseActionCost(100)).toBe(9);
  });
  it("caps overflowed favorability at the max tier", () => {
    expect(getAdvertiseActionCost(140)).toBe(9);
  });
});

describe("getCampaignActionCost", () => {
  it("caps overflowed influence at the max tier", () => {
    expect(getCampaignActionCost(140)).toBe(5);
  });
});

describe("getDonorActionCost", () => {
  it("fundraise: flat 3 AP regardless of donor level", () => {
    expect(getDonorActionCost(0, "fundraise")).toBe(3);
    expect(getDonorActionCost(10, "fundraise")).toBe(3);
    expect(getDonorActionCost(50, "fundraise")).toBe(3);
    expect(getDonorActionCost(75, "fundraise")).toBe(3);
  });
  it("buildDonorBase: scales from 4 at L0 to 20 at L75", () => {
    expect(getDonorActionCost(0, "buildDonorBase")).toBe(4);
    expect(getDonorActionCost(10, "buildDonorBase")).toBe(5);
    expect(getDonorActionCost(25, "buildDonorBase")).toBe(7);
    expect(getDonorActionCost(50, "buildDonorBase")).toBe(13);
    expect(getDonorActionCost(75, "buildDonorBase")).toBe(20);
  });
});

describe("getFundMultiplier", () => {
  it("returns 1.0 at tier 0 with average-GDP state", () => {
    // gdpPerCapita = (69_618 * 1_000_000) / 1_000_000 = 69_618 → scalar = 1.0, tier 0 → 1.0
    expect(getFundMultiplier(0, 69_618, 1_000_000)).toBeCloseTo(1.0);
  });
  it("clamps gdp scalar to 0.85 minimum", () => {
    expect(getFundMultiplier(0, 1, 10_000_000)).toBeCloseTo(0.85);
  });
  it("clamps gdp scalar to 2.0 maximum", () => {
    expect(getFundMultiplier(0, 1_000_000, 1_000_000)).toBeCloseTo(2.0);
  });
  it("applies tier modifier: tier 2 with average GDP → 1.4", () => {
    expect(getFundMultiplier(2, 69_618, 1_000_000)).toBeCloseTo(1.4);
  });

  it("does not saturate the cost ceiling for a representative NG region", () => {
    // NG state GDP is stored in naira-millions. Without a naira baseline,
    // gdpPerCapita / 65_000 (~4.4M / 65K ≈ 68) pinned every NG region to the
    // 2.0 cost ceiling. With the NG baseline it scales ~1.0–1.6 instead.
    // South-South: gdp ₦58.87B (naira-millions), pop 13.39M → per-capita ~₦4.4M.
    const mult = getFundMultiplier(0, 58_873_063, 13_392_943, "NG");
    expect(mult).toBeLessThan(2.0);
    expect(mult).toBeGreaterThan(1.0);
  });
});

describe("getFundMultiplier era parameter (issue #798)", () => {
  it("resolves 1.0 for a 1953-scale JP region under its own era", () => {
    // JP 1953 seeds are USD-anchored: per-capita $277 vs the 1953 baseline.
    const pop = 10_000_000;
    const gdpMillions1953 = (277 * pop) / 1_000_000;
    expect(getFundMultiplier(0, gdpMillions1953, pop, "JP", "1953-default")).toBeCloseTo(1.0);
  });

  it("pins the same 1953-scale JP region to the floor under the modern default", () => {
    // $277 USD-anchored per-capita against the ¥4.17M modern baseline: the era
    // parameter is load-bearing, not cosmetic.
    const pop = 10_000_000;
    const gdpMillions1953 = (277 * pop) / 1_000_000;
    expect(getFundMultiplier(0, gdpMillions1953, pop, "JP")).toBeCloseTo(0.85);
    expect(getFundMultiplier(0, gdpMillions1953, pop, "JP", "2019-default")).toBeCloseTo(0.85);
  });

  it("resolves 1.0 for an average NG region in both 1953 and 2019 eras", () => {
    const pop = 10_000_000;
    expect(getFundMultiplier(0, (113 * pop) / 1_000_000, pop, "NG", "1953-default")).toBeCloseTo(
      1.0
    );
    expect(
      getFundMultiplier(0, (3_669_401 * pop) / 1_000_000, pop, "NG", "2019-default")
    ).toBeCloseTo(1.0);
  });

  it("throws for countries without an explicit baseline", () => {
    expect(() => getFundMultiplier(0, 100_000, 1_000_000, "XX")).toThrow(/no GDP baseline/);
    expect(() => getFundMultiplier(0, 100_000, 1_000_000, "BR", "1953-default")).toThrow(
      /no GDP baseline/
    );
  });
});

function makeCharacter(overrides: {
  actions?: number;
  funds?: number;
  favorability?: number;
  donorBaseLevel?: number;
  politicalInfluence?: number;
  cashOnHand?: number;
  savingsOnHand?: number;
  stats?: Character["stats"];
}): Character {
  return {
    _id: "test" as unknown as import("mongodb").ObjectId,
    userId: "u" as unknown as import("mongodb").ObjectId,
    name: "Test",
    homeState: "NY",
    countryId: "US",
    party: "independent",
    actions: overrides.actions ?? 10,
    funds: overrides.funds ?? 1_000_000,
    cashOnHand: overrides.cashOnHand ?? 0,
    savingsOnHand: overrides.savingsOnHand ?? 0,
    favorability: overrides.favorability ?? 0,
    infamy: 0,
    donorBaseLevel: overrides.donorBaseLevel ?? 0,
    politicalInfluence: overrides.politicalInfluence ?? 0,
    stats: overrides.stats,
    demographics: { race: "white", gender: "male", education: "college", wealth: "middle" },
    policies: { economic: 0, social: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Character;
}

// Average-GDP home state (scalar 1.0) and neutral charisma (multiplier 1.0):
// the advertise quote requires both, rejecting neutral fallbacks instead.
const AVG_STATE = { gdp: 69_618, population: 1_000_000, name: "Test State" } as State;
const NEUTRAL_STATS = { charisma: 5.5 } as Character["stats"];

// Average-GDP home state (scalar 1.0): the donor quote requires home-state
// economics, rejecting neutral fallbacks instead.
const AVG_GDP_STATE = { gdp: 69_618, population: 1_000_000, name: "Test State" } as State;

describe("canPerformAction — tiered costs", () => {
  it("advertise blocked when actions < tiered cost (high fav)", () => {
    const char = makeCharacter({ actions: 7, favorability: 90, stats: NEUTRAL_STATS }); // tier 4, needs 9
    const result = canPerformAction(char, "advertise", AVG_STATE);
    expect(result.canPerform).toBe(false);
    expect(result.reason).toContain("9");
  });

  it("advertise allowed when actions >= tiered cost", () => {
    const char = makeCharacter({
      actions: 9,
      favorability: 90,
      funds: 1_000_000,
      stats: NEUTRAL_STATS,
    });
    const result = canPerformAction(char, "advertise", AVG_STATE);
    expect(result.canPerform).toBe(true);
  });

  it("fundraise allowed at any donor level (flat 3 AP cost)", () => {
    const char = makeCharacter({ actions: 3, donorBaseLevel: 75 });
    const result = canPerformAction(char, "fundraise");
    expect(result.canPerform).toBe(true);
  });

  it("buildDonorBase blocked at high donor level when AP insufficient", () => {
    const char = makeCharacter({ actions: 12, donorBaseLevel: 75, funds: 1_000_000 }); // L75 needs 20
    // Neutral fundraising (pivot 5.5 → 1.0x), average-GDP state and an
    // explicit country basis: the donor quote requires all three, rejecting
    // neutral fallbacks instead.
    char.stats = { fundraising: 5.5 } as Character["stats"];
    char.countryId = "US";
    const result = canPerformAction(char, "buildDonorBase", AVG_GDP_STATE);
    expect(result.canPerform).toBe(false);
    expect(result.reason).toContain("20");
  });

  it("poll still uses base cost (2) regardless of stats", () => {
    const char = makeCharacter({
      actions: 2,
      funds: 1_000_000,
      stats: { intellect: 5.5 } as Character["stats"],
    });
    const result = canPerformAction(char, "poll");
    expect(result.canPerform).toBe(true);
  });

  it("convertCash is blocked when the character only has savings", () => {
    const char = makeCharacter({ actions: 5, cashOnHand: 0, savingsOnHand: 500_000 });
    const result = canPerformAction(char, "convertCash");
    expect(result.canPerform).toBe(false);
    expect(result.reason).toContain("no personal cash");
  });
});

describe("canPerformAction — insufficient-funds message currency", () => {
  it("reports the shortfall in LOCAL currency, never anchor (₳)", () => {
    // No forex: anchor == local. Old code emitted ₳; the fix uses the local symbol.
    const char = makeCharacter({ actions: 9, favorability: 90, funds: 100, stats: NEUTRAL_STATS }); // advertise costs 180k
    const result = canPerformAction(char, "advertise", AVG_STATE);
    expect(result.canPerform).toBe(false);
    expect(result.reason).not.toContain("₳");
    expect(result.reason).toContain("$");
  });

  it("converts the anchor cost to local magnitude when forex is enabled", () => {
    // advertise (fav 90, average-GDP state): cost = 180,000 anchor. rate 0.9 → 162,000 local.
    const char = makeCharacter({ actions: 9, favorability: 90, stats: NEUTRAL_STATS });
    char.currencyBalances = { campaign: 1, personal: {} } as Character["currencyBalances"];
    const result = canPerformAction(char, "advertise", AVG_STATE, {
      forexEnabled: true,
      homeFxRate: 0.9,
    });
    expect(result.canPerform).toBe(false);
    expect(result.reason).not.toContain("₳");
    expect(result.reason).toContain("162,000");
  });
});

describe("action effect messages — local currency", () => {
  // Formatter the execute route supplies: anchor → local (rate 0.9), local symbol.
  const ctx: ActionEffectContext = {
    formatFunds: (anchor: number) => `€${Math.round(anchor * 0.9).toLocaleString()}`,
  };

  it("advertise message renders the spend via the local formatter, no ₳", () => {
    const char = makeCharacter({ favorability: 90, stats: NEUTRAL_STATS });
    const r = ACTIONS.advertise.effect(char, AVG_STATE, ctx);
    expect(r.message).not.toContain("₳");
    expect(r.message).toContain("€");
  });

  it("buildDonorBase message renders the spend via the local formatter, no ₳", () => {
    const char = makeCharacter({ donorBaseLevel: 0 });
    char.stats = { fundraising: 5.5 } as Character["stats"];
    char.countryId = "US";
    const r = ACTIONS.buildDonorBase.effect(char, AVG_GDP_STATE, ctx);
    expect(r.message).not.toContain("₳");
    expect(r.message).toContain("€");
  });

  it("fundraise message renders the yield via the local formatter, no ₳", () => {
    const char = makeCharacter({ donorBaseLevel: 10 });
    const r = ACTIONS.fundraise.effect(char, undefined, ctx);
    expect(r.message).not.toContain("₳");
    expect(r.message).toContain("€");
  });
});

describe("buildBatchResultMessage — local currency", () => {
  function withCampaign(local: number): Character {
    const c = makeCharacter({});
    c.currencyBalances = { campaign: local, personal: {} } as Character["currencyBalances"];
    return c;
  }

  it("reports the campaign-fund delta in LOCAL currency magnitude with symbol", () => {
    // Balances are LOCAL: delta = 180,000. Pre-fix code divided by the FX rate
    // and emitted an unsymboled anchor magnitude.
    const before = withCampaign(1_000_000);
    const after = withCampaign(1_180_000);
    const msg = buildBatchResultMessage(5, before, after, "fallback", "USD");
    expect(msg).toContain("$180,000");
    expect(msg).not.toContain("₳");
  });
});
