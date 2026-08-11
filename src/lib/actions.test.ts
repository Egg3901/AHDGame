import { describe, it, expect } from "vitest";
import type { Character } from "@/lib/db/types";
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
    // gdpPerCapita = (65_000 * 1_000_000) / 1_000_000 = 65_000 → scalar = 1.0, tier 0 → 1.0
    expect(getFundMultiplier(0, 65_000, 1_000_000)).toBeCloseTo(1.0);
  });
  it("clamps gdp scalar to 0.85 minimum", () => {
    expect(getFundMultiplier(0, 1, 10_000_000)).toBeCloseTo(0.85);
  });
  it("clamps gdp scalar to 2.0 maximum", () => {
    expect(getFundMultiplier(0, 1_000_000, 1_000_000)).toBeCloseTo(2.0);
  });
  it("applies tier modifier: tier 2 with average GDP → 1.4", () => {
    expect(getFundMultiplier(2, 65_000, 1_000_000)).toBeCloseTo(1.4);
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

function makeCharacter(overrides: {
  actions?: number;
  funds?: number;
  favorability?: number;
  donorBaseLevel?: number;
  politicalInfluence?: number;
  cashOnHand?: number;
  savingsOnHand?: number;
}): Character {
  return {
    _id: "test" as unknown as import("mongodb").ObjectId,
    userId: "u" as unknown as import("mongodb").ObjectId,
    name: "Test",
    homeState: "NY",
    party: "independent",
    actions: overrides.actions ?? 10,
    funds: overrides.funds ?? 1_000_000,
    cashOnHand: overrides.cashOnHand ?? 0,
    savingsOnHand: overrides.savingsOnHand ?? 0,
    favorability: overrides.favorability ?? 0,
    infamy: 0,
    donorBaseLevel: overrides.donorBaseLevel ?? 0,
    politicalInfluence: overrides.politicalInfluence ?? 0,
    demographics: { race: "white", gender: "male", education: "college", wealth: "middle" },
    policies: { economic: 0, social: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Character;
}

describe("canPerformAction — tiered costs", () => {
  it("advertise blocked when actions < tiered cost (high fav)", () => {
    const char = makeCharacter({ actions: 7, favorability: 90 }); // tier 4, needs 9
    const result = canPerformAction(char, "advertise");
    expect(result.canPerform).toBe(false);
    expect(result.reason).toContain("9");
  });

  it("advertise allowed when actions >= tiered cost", () => {
    const char = makeCharacter({ actions: 9, favorability: 90, funds: 1_000_000 });
    const result = canPerformAction(char, "advertise");
    expect(result.canPerform).toBe(true);
  });

  it("fundraise allowed at any donor level (flat 3 AP cost)", () => {
    const char = makeCharacter({ actions: 3, donorBaseLevel: 75 });
    const result = canPerformAction(char, "fundraise");
    expect(result.canPerform).toBe(true);
  });

  it("buildDonorBase blocked at high donor level when AP insufficient", () => {
    const char = makeCharacter({ actions: 12, donorBaseLevel: 75, funds: 1_000_000 }); // L75 needs 20
    const result = canPerformAction(char, "buildDonorBase");
    expect(result.canPerform).toBe(false);
    expect(result.reason).toContain("20");
  });

  it("poll still uses base cost (2) regardless of stats", () => {
    const char = makeCharacter({ actions: 2, funds: 1_000_000 });
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
    const char = makeCharacter({ actions: 9, favorability: 90, funds: 100 }); // advertise costs 180k
    const result = canPerformAction(char, "advertise");
    expect(result.canPerform).toBe(false);
    expect(result.reason).not.toContain("₳");
    expect(result.reason).toContain("$");
  });

  it("converts the anchor cost to local magnitude when forex is enabled", () => {
    // advertise (fav 90, no state): cost = 180,000 anchor. rate 0.9 → 162,000 local.
    const char = makeCharacter({ actions: 9, favorability: 90 });
    char.currencyBalances = { campaign: 1, personal: {} } as Character["currencyBalances"];
    const result = canPerformAction(char, "advertise", undefined, {
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
    const char = makeCharacter({ favorability: 90 });
    const r = ACTIONS.advertise.effect(char, undefined, ctx);
    expect(r.message).not.toContain("₳");
    expect(r.message).toContain("€");
  });

  it("buildDonorBase message renders the spend via the local formatter, no ₳", () => {
    const char = makeCharacter({ donorBaseLevel: 0 });
    const r = ACTIONS.buildDonorBase.effect(char, undefined, ctx);
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
