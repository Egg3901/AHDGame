import { describe, it, expect } from "vitest";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";
import { trendGrowthRate } from "@/lib/utils/sectorGrowth";
import { GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";
import { resolveSectorGrowthPolicy, type SectorGrowthPolicyInput } from "./sectorGrowthPolicy";

const marketCorp = {
  countryId: "US",
  countryOwnerId: null,
  ownershipState: null,
} as unknown as Corporation;
const stateCorp = { countryId: "US", countryOwnerId: "US" } as unknown as Corporation;
const sovietCorp = { countryId: "RU", countryOwnerId: "RU" } as unknown as Corporation;

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    countryId: "US",
    sectorType: "manufacturing",
    revenue: 10_000,
    currentGrowthRate: 3,
    targetGrowthRate: 3,
    currentGrowthCost: 0,
    profitMargin: 20,
    ...overrides,
  } as CorporateSector;
}

function run(overrides: Partial<SectorGrowthPolicyInput> = {}) {
  return resolveSectorGrowthPolicy({
    corp: marketCorp,
    sector: makeSector(),
    currentYear: 1953,
    commandEconomyEnabled: false,
    sectorRevenueAnchor: 10_000,
    plantsEnabled: false,
    embargoSuppressed: false,
    useTradeExposureEmbargo: false,
    ...overrides,
  });
}

describe("resolveSectorGrowthPolicy", () => {
  it("holds an affordable market sector at its trended rate and grows revenue", () => {
    const result = run();
    expect(result.brakedTargetRate).toBe(3);
    expect(result.newCurrentGrowthRate).toBe(3);
    expect(result.perTurnGrowthRate).toBeCloseTo(3 / GROWTH_RATE_TURNS_PER_YEAR, 10);
    expect(result.newRevenue).toBeCloseTo(10_000 * (1 + result.perTurnGrowthRate / 100), 10);
    expect(result.preFlipNameplateRevenue).toBe(result.newRevenue);
  });

  it("brakes the target by 0.5pp when growth cost eats half the margin", () => {
    // 20% margin, growth cost 10% of revenue => at the 50%-of-margin ceiling.
    const result = run({ sector: makeSector({ currentGrowthCost: 1_000 }) });
    expect(result.brakedTargetRate).toBe(2.5);
    expect(result.newCurrentGrowthRate).toBe(2.5);
  });

  it("brakes when the sector runs at a loss", () => {
    const result = run({ sector: makeSector({ profitMargin: -5 }) });
    expect(result.brakedTargetRate).toBe(2.5);
  });

  it("never brakes a zero-revenue newborn sector", () => {
    const result = run({ sector: makeSector({ revenue: 0, profitMargin: -100 }) });
    expect(result.brakedTargetRate).toBe(3);
  });

  it("pulls a command-economy sector toward trend x plan priority by at most 0.02pp", () => {
    const trend = getEraTrendGdpGrowth("RU", 1953);
    expect(trend).toBeGreaterThan(0);
    const planned = Math.round(trend! * 1.2 * 100) / 100; // manufacturing priority
    const seedTarget = planned - 5;
    const result = run({
      corp: sovietCorp,
      sector: makeSector({
        countryId: "RU",
        targetGrowthRate: seedTarget,
        currentGrowthRate: seedTarget,
      }),
      commandEconomyEnabled: true,
    });
    expect(result.brakedTargetRate).toBeCloseTo(seedTarget + 0.02, 10);
  });

  it("depresses Group B sectors below the national trend under a command plan", () => {
    const trend = getEraTrendGdpGrowth("RU", 1953)!;
    const agriculture = run({
      corp: sovietCorp,
      sector: makeSector({
        countryId: "RU",
        sectorType: "agriculture",
        targetGrowthRate: trend,
        currentGrowthRate: trend,
      }),
      commandEconomyEnabled: true,
    });
    const defense = run({
      corp: sovietCorp,
      sector: makeSector({
        countryId: "RU",
        sectorType: "defense",
        targetGrowthRate: trend,
        currentGrowthRate: trend,
      }),
      commandEconomyEnabled: true,
    });
    // Agriculture (0.65x) is pulled down, defense (1.25x) up.
    expect(agriculture.brakedTargetRate).toBeLessThan(trend);
    expect(defense.brakedTargetRate).toBeGreaterThan(trend);
  });

  it("exempts a soft-budget sector from the affordability brake", () => {
    const result = run({
      corp: sovietCorp,
      sector: makeSector({ countryId: "RU", profitMargin: -50, currentGrowthCost: 5_000 }),
      commandEconomyEnabled: true,
    });
    // Braking would subtract 0.5; the plan path never does.
    expect(result.brakedTargetRate).not.toBe(2.5);
  });

  it("recovers a market-economy SOE toward the era trend anchor", () => {
    // FR authors a 1953 trendGdpGrowth (4.5); US does not, so a US SOE has no
    // recovery anchor and its zero target stays put.
    const anchor = getEraTrendGdpGrowth("FR", 1953);
    expect(anchor).toBeGreaterThan(0.5);
    const result = run({
      corp: stateCorp,
      sector: makeSector({ countryId: "FR", targetGrowthRate: 0, currentGrowthRate: 0 }),
    });
    expect(result.brakedTargetRate).toBe(0.5);
    const unanchored = run({
      corp: stateCorp,
      sector: makeSector({ targetGrowthRate: 0, currentGrowthRate: 0 }),
    });
    expect(unanchored.brakedTargetRate).toBe(0);
  });

  it("trends the current rate toward the target one step per turn", () => {
    const result = run({ sector: makeSector({ currentGrowthRate: 1, targetGrowthRate: 5 }) });
    expect(result.newCurrentGrowthRate).toBe(trendGrowthRate(1, 5));
  });

  it("freezes revenue under a legacy embargo mothball", () => {
    const result = run({ embargoSuppressed: true });
    expect(result.embargoLegacyMothball).toBe(true);
    expect(result.embargoTradeExposureActive).toBe(false);
    expect(result.newRevenue).toBe(10_000);
    expect(result.preFlipNameplateRevenue).toBe(10_000);
  });

  it("keeps growing nameplate under a trade-exposure embargo", () => {
    const result = run({ embargoSuppressed: true, useTradeExposureEmbargo: true });
    expect(result.embargoLegacyMothball).toBe(false);
    expect(result.embargoTradeExposureActive).toBe(true);
    expect(result.newRevenue).toBeGreaterThan(10_000);
    expect(result.preFlipNameplateRevenue).toBe(result.newRevenue);
  });

  it("holds stored revenue flat when plants own the revenue chain, but still grows nameplate", () => {
    const result = run({ plantsEnabled: true });
    expect(result.newRevenue).toBe(10_000);
    expect(result.preFlipNameplateRevenue).toBeGreaterThan(10_000);
  });
});
