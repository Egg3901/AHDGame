import { describe, expect, it } from "vitest";
import { INITIAL_RATES_1953 } from "@/lib/constants/currencies";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { computeLawCost, type FiscalBase } from "./costEngine";
import { getCatalog } from "./catalog";
import type { LawCountryId } from "./types";

function baselineCost(countryId: LawCountryId, base: FiscalBase): number {
  let cost = 0;
  for (const law of getCatalog(countryId)) {
    if (law.kind === "tax") continue;
    const level = law.baselineLevel ?? 0;
    if (level === 0) continue;
    cost += computeLawCost(law.levels![level], base, countryId, null).cost;
  }
  return cost;
}

describe("RU vs US 1953 fiscal scale after the union-republic split", () => {
  const ruLive: FiscalBase = {
    gdp: ruRegions1953.reduce((s, r) => s + r.gdp, 0) * 1_000_000,
    population: ruRegions1953.reduce((s, r) => s + r.population, 0),
  };
  const ruStale: FiscalBase = { gdp: 1_400_000_000_000, population: 189_500_000 };
  const us: FiscalBase = { gdp: 397_100_000_000, population: 151_300_000 };

  it("live RU rollup is the post-split ₽1.029T / ~148.5M base, not the ₽1.4T union", () => {
    expect(ruLive.gdp).toBeGreaterThan(1_024_000_000_000);
    expect(ruLive.gdp).toBeLessThan(1_035_000_000_000);
    expect(ruLive.population).toBeGreaterThan(145_000_000);
    expect(ruLive.population).toBeLessThan(152_000_000);
  });

  it("baseline RU outlays on the live rollup stay near ruling-#15's 38% of GDP", () => {
    const cost = baselineCost("RU", ruLive);
    const share = cost / ruLive.gdp;
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.45);
  });

  it("FX-converted RU baseline spending is not several times US spending", () => {
    const ruCost = baselineCost("RU", ruLive);
    const usCost = baselineCost("US", us);
    const surPerUsd = INITIAL_RATES_1953.RU!;
    const ruUsd = ruCost / surPerUsd;
    // Ticket #1065 compared ₽565B to $100B as if both were dollars.
    // At the authored 9 SUR/USD rate, Soviet outlays must not read as a
    // several-times-larger US-dollar budget.
    expect(ruUsd / usCost).toBeLessThan(1.5);
    expect(ruUsd / usCost).toBeGreaterThan(0.4);
  });

  it("stale ₽1.4T union base still prices near the catalog's §5 golden", () => {
    const cost = baselineCost("RU", ruStale);
    expect(cost / 535_000_000_000 - 1).toBeCloseTo(-0.053, 2);
  });
});
