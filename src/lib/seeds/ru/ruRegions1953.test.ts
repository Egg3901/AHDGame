import { describe, expect, it } from "vitest";
import { INITIAL_RATES_1953 } from "@/lib/constants/currencies";
import { INCOME_ANCHORS } from "@/lib/era/metricCatalog";
import { ruRegions1953 } from "./ruRegions1953";

describe("ruRegions1953 fiscal basis (spec §4.1 re-scale ruling)", () => {
  it("rolls up to the ₽1.029T budget basis (±0.5%)", () => {
    const rollup = ruRegions1953.reduce((sum, r) => sum + r.gdp, 0);
    // gdp is stored in millions. The basis was ₽1.4T while Ukraine, Byelorussia
    // and the Baltics were RU regions; they took ₽370,834M with them when they
    // became their own countries, leaving ₽1,029,166M. budgets.ts moved with it.
    expect(rollup).toBeGreaterThan(1_024_000);
    expect(rollup).toBeLessThan(1_035_000);
    for (const region of ruRegions1953) expect(region.gdp).toBeGreaterThan(0);
  });

  it("keeps the population basis at the post-split RU total (~148.5M)", () => {
    // Was ~200.1M for the full Union. Ukraine (41M), Byelorussia (7.7M) and the
    // Baltics (2.9M) left for their own countries: 51.6M.
    const pop = ruRegions1953.reduce((sum, r) => sum + r.population, 0);
    expect(pop).toBeGreaterThan(145_000_000);
    expect(pop).toBeLessThan(152_000_000);
  });

  it("SUR calibration: RU/US economic ratio lands in the 25–35% band", () => {
    // Spec §4.1 plan-time check: region-sum × SUR rate must NOT read near-US-sized.
    // The historical whole-Union band was 35–45%; RU without Ukraine,
    // Byelorussia and the Baltics is ~74% of that rollup, hence ~26–33%.
    const ruRollupRoubles = ruRegions1953.reduce((sum, r) => sum + r.gdp, 0) * 1_000_000;
    const surPerUsd = INITIAL_RATES_1953.RU!;
    const usRollupUsd = 397_100_000_000;
    const ratio = ruRollupRoubles / surPerUsd / usRollupUsd;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it("RU display income anchors exist and start near the seeded income scale", () => {
    const anchors = INCOME_ANCHORS.RU!;
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    const first = anchors[0];
    expect(first.year).toBe(1953);
    // The anchor must sit near the scale the world actually SEEDS, not the
    // fiscal old-rouble scale. That target has moved twice now:
    //   - originally ₽3,500, tracking the legacy ruStateMetrics ₽4,000 bundle
    //     (income-band index resolved to 0.46 instead of ~1);
    //   - then ₽1,600, matching a 1953 overlay (ruMetricPresets1953.ts) that
    //     itself measured out at ratio 0.213x GDP/capita
    //     (medianIncomeGdpScale1953.test.ts-style band [0.8, 2.6]) —
    //     under-scaled by roughly 5x against the real average Soviet monthly
    //     wage of the early 1950s (#income-gdp-scale-audit).
    // Now ₽10,500 (regions ₽7,200-15,800), ratio ~1.4x GDP/capita.
    expect(first.value).toBeGreaterThan(9_000);
    expect(first.value).toBeLessThan(12_000);
  });
});
