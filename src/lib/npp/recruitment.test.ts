import { describe, it, expect } from "vitest";
import {
  calculateRecruitmentSlots,
  calculateRecruitmentCost,
  calculateRelocationCapacity,
  calculateRelocationRequestCost,
  getPartyModifiers,
} from "./recruitment";

describe("calculateRecruitmentSlots", () => {
  it("returns the default 2 slots below 30% org", () => {
    expect(calculateRecruitmentSlots(0)).toBe(2);
    expect(calculateRecruitmentSlots(29)).toBe(2);
  });

  it("returns 3 slots for org 30-39%", () => {
    expect(calculateRecruitmentSlots(30)).toBe(3);
    expect(calculateRecruitmentSlots(39)).toBe(3);
  });

  it("returns 4 slots for org 40-49%", () => {
    expect(calculateRecruitmentSlots(40)).toBe(4);
    expect(calculateRecruitmentSlots(49)).toBe(4);
  });

  it("returns the 5-slot total cap at and above 50% org", () => {
    expect(calculateRecruitmentSlots(50)).toBe(5);
    expect(calculateRecruitmentSlots(100)).toBe(5);
  });

  it("leaves an over-cap state with no available slots until org climbs back", () => {
    // A state recruited to 5 NPPs at 50% org keeps all of them when org falls,
    // but the live cap shrinks, so currentNPPs >= cap blocks new recruitment.
    const recruitedNPPs = 5;
    expect(recruitedNPPs >= calculateRecruitmentSlots(20)).toBe(true); // cap 2, over cap
    expect(recruitedNPPs >= calculateRecruitmentSlots(40)).toBe(true); // cap 4, still over
    expect(recruitedNPPs >= calculateRecruitmentSlots(50)).toBe(true); // cap 5, exactly full
  });
});

describe("calculateRecruitmentCost", () => {
  it("returns base cost for first NPP in state with no party NPPs", () => {
    const cost = calculateRecruitmentCost(0, 0);
    expect(cost.actions).toBe(5);
    expect(cost.funds).toBe(100000);
  });

  it("returns tier 1 cost for second NPP in state", () => {
    const cost = calculateRecruitmentCost(1, 0);
    expect(cost.actions).toBe(8);
    expect(cost.funds).toBe(200000);
  });

  it("returns tier 4 cost for 5th+ NPP in state", () => {
    const cost = calculateRecruitmentCost(5, 0);
    expect(cost.actions).toBe(25);
    expect(cost.funds).toBe(1000000);
  });

  it("applies party-wide action modifier (+1 per 20 NPPs, cap 5)", () => {
    expect(calculateRecruitmentCost(0, 20).actions).toBe(6);
    expect(calculateRecruitmentCost(0, 60).actions).toBe(8);
    expect(calculateRecruitmentCost(0, 100).actions).toBe(10);
    expect(calculateRecruitmentCost(0, 200).actions).toBe(10);
  });

  it("applies party-wide fund modifier (+10% per 20 NPPs, cap 100%)", () => {
    expect(calculateRecruitmentCost(0, 20).funds).toBe(110000);
    expect(calculateRecruitmentCost(0, 60).funds).toBe(130000);
    expect(calculateRecruitmentCost(0, 200).funds).toBe(200000);
    expect(calculateRecruitmentCost(0, 300).funds).toBe(200000);
  });

  it("combines state tier and party modifiers correctly", () => {
    const cost = calculateRecruitmentCost(2, 60);
    expect(cost.actions).toBe(15);
    expect(cost.funds).toBe(455000);
  });
});

describe("getPartyModifiers", () => {
  it("returns 0 modifiers for <20 NPPs", () => {
    const mods = getPartyModifiers(0);
    expect(mods.actionModifier).toBe(0);
    expect(mods.fundModifierPercent).toBe(0);
  });

  it("returns correct modifiers for 60 NPPs", () => {
    const mods = getPartyModifiers(60);
    expect(mods.actionModifier).toBe(3);
    expect(mods.fundModifierPercent).toBe(30);
  });

  it("caps modifiers correctly", () => {
    const mods = getPartyModifiers(250);
    expect(mods.actionModifier).toBe(5);
    expect(mods.fundModifierPercent).toBe(100);
  });
});

describe("calculateRelocationRequestCost", () => {
  it("prices relocation at 25% of the target-state recruitment cost", () => {
    const moveCost = calculateRelocationRequestCost(0, 0);
    expect(moveCost.actions).toBe(2);
    expect(moveCost.funds).toBe(25000);
  });

  it("rounds upward so relocation never becomes underpriced on odd tiers", () => {
    const moveCost = calculateRelocationRequestCost(4, 60);
    expect(moveCost.actions).toBe(7);
    expect(moveCost.funds).toBe(325000);
  });
});

describe("calculateRelocationCapacity", () => {
  it("falls back to the recruitment cap for a party with a tiny roster", () => {
    // 2 NPPs over 50 regions: fair share rounds to 1, so the 2-slot recruitment
    // floor is what binds.
    expect(calculateRelocationCapacity(0, 2, 50)).toBe(2);
    expect(calculateRelocationCapacity(75, 2, 50)).toBe(5);
  });

  it("scales with the roster so a seeded party can still move politicians", () => {
    // The #3833 case: 400 NPPs over 12 regions is a fair share of 34, x1.5 = 50.
    // Under the old recruitment cap this was 2 and every region read as full.
    expect(calculateRelocationCapacity(0, 400, 12)).toBe(50);
  });

  it("never lets one region hold the whole roster", () => {
    expect(calculateRelocationCapacity(100, 400, 12)).toBeLessThan(400);
  });

  it("treats a country with no regions as a single region rather than dividing by zero", () => {
    expect(Number.isFinite(calculateRelocationCapacity(0, 10, 0))).toBe(true);
    expect(calculateRelocationCapacity(0, 10, 0)).toBe(15);
  });

  it("is at least the recruitment cap at every organization tier", () => {
    for (const org of [0, 30, 40, 50, 100]) {
      expect(calculateRelocationCapacity(org, 0, 50)).toBe(calculateRecruitmentSlots(org));
    }
  });
});
