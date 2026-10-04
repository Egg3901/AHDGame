import { describe, it, expect } from "vitest";
import {
  calculateMaintenanceCosts,
  calculateMediaMaintenanceAfterDowngrade,
  calculateMediaMaintenanceCosts,
} from "./maintenance";
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

describe("calculateMediaMaintenanceAfterDowngrade", () => {
  it("uses the downgraded legacy media level for the funded upkeep amount", () => {
    const campaign = { mediaSpendingLevel: 3 } as Campaign;
    const downgraded = { ...campaign, mediaSpendingLevel: 2 } as Campaign;

    expect(
      calculateMediaMaintenanceAfterDowngrade(
        campaign,
        [{ category: "mediaSpending", fromLevel: 3, toLevel: 2 }],
        undefined
      )
    ).toBe(calculateMediaMaintenanceCosts(downgraded));
  });

  it("uses the downgraded branch level without mutating the campaign snapshot", () => {
    const campaign = {
      mediaSpendingLevel: 0,
      mediaSpendingTree: { starter: true, a: 2, b: 0, c: 0 },
    } as Campaign;
    const downgraded = {
      ...campaign,
      mediaSpendingTree: { ...campaign.mediaSpendingTree!, a: 1 },
    } as Campaign;

    expect(
      calculateMediaMaintenanceAfterDowngrade(
        campaign,
        [{ category: "mediaSpending", branch: "a", fromLevel: 2, toLevel: 1 }],
        undefined
      )
    ).toBe(calculateMediaMaintenanceCosts(downgraded));
    expect(campaign.mediaSpendingTree?.a).toBe(2);
  });
});
