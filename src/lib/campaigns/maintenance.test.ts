import { describe, it, expect } from "vitest";
import { calculateMaintenanceCosts } from "./maintenance";
import type { Campaign } from "@/lib/db/types";

describe("calculateMaintenanceCosts", () => {
  it("calculates zero maintenance for level 0", () => {
    const campaign = {
      groundGameLevel: 0,
      mediaSpendingLevel: 0,
    } as Campaign;

    expect(calculateMaintenanceCosts(campaign)).toBe(0);
  });

  it("calculates maintenance for ground game only", () => {
    const campaign = {
      groundGameLevel: 2,
      mediaSpendingLevel: 0,
    } as Campaign;

    // Level 1: 5500, Level 2: 16500, Total: 22000 (cumulative from upgradeCosts.ts)
    expect(calculateMaintenanceCosts(campaign)).toBe(22000);
  });

  it("calculates maintenance for media spending only", () => {
    const campaign = {
      groundGameLevel: 0,
      mediaSpendingLevel: 3,
    } as Campaign;

    // Level 1: 6000, Level 2: 18000, Level 3: 42000, Total: 66000 (cumulative)
    expect(calculateMaintenanceCosts(campaign)).toBe(66000);
  });

  it("calculates combined maintenance costs", () => {
    const campaign = {
      groundGameLevel: 2,
      mediaSpendingLevel: 2,
    } as Campaign;

    // Ground: 22000 (5500+16500), Media: 24000 (6000+18000)
    expect(calculateMaintenanceCosts(campaign)).toBe(46000);
  });
});
