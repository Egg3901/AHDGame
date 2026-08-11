import { describe, expect, it } from "vitest";
import { budgetKeyForLaw } from "./budgetKeys";
import { computeLawCost } from "./costEngine";
import { RU_LAWS } from "./laws/ruLaws";
import { UK_LAWS } from "./laws/ukLaws";
import { US_LAWS } from "./laws/usLaws";

const UK_BASE = { gdp: 19_800_000_000, population: 52_600_000 };
const US_BASE = { gdp: 397_100_000_000, population: 151_300_000 };
const RU_BASE = { gdp: 1_400_000_000_000, population: 189_500_000 };

describe("computeLawCost", () => {
  it("prices the UK NHS L4 at ≈£429M on the 1953 base (income term)", () => {
    const nhs = UK_LAWS.find((l) => l.id === "uk.health.universalCare.primary")!;
    const r = computeLawCost(nhs.levels![4], UK_BASE, "UK", null);
    // 0.0308 × £265 × 52.6M ≈ £429.3M
    expect(r.cost).toBeGreaterThan(425_000_000);
    expect(r.cost).toBeLessThan(434_000_000);
    expect(r.revenue).toBe(0);
    expect(r.net).toBe(-r.cost);
  });

  it("sums the UK health-key baseline total to ≈£566M (§4.2 key-total golden)", () => {
    let total = 0;
    for (const law of UK_LAWS) {
      if (law.kind === "tax" || budgetKeyForLaw(law) !== "health") continue;
      total += computeLawCost(law.levels![law.baselineLevel!], UK_BASE, "UK", null).cost;
    }
    expect(total).toBeGreaterThan(554_000_000);
    expect(total).toBeLessThan(578_000_000);
  });

  it("prices the US armed-forces primary through the gdp term only", () => {
    const law = US_LAWS.find((l) => l.id === "us.defense.armedForces.primary")!;
    const level = law.levels![law.baselineLevel!];
    expect(level.incomeCostFraction).toBeUndefined();
    const r = computeLawCost(level, US_BASE, "US", null);
    expect(r.cost).toBeCloseTo(level.gdpCostFraction! * US_BASE.gdp, 0);
  });

  it("uses regional gdp/population for regional scope (smaller base, smaller cost)", () => {
    const law = RU_LAWS.find((l) => l.id === "ru.infrastructure.transit.primary")!;
    const level = law.levels![3];
    const national = computeLawCost(level, RU_BASE, "RU", null);
    const regional = computeLawCost(
      level,
      { gdp: 140_000_000_000, population: 19_000_000 },
      "RU",
      null
    );
    expect(regional.cost).toBeCloseTo(national.cost / 10, -3);
  });

  it("treats a null band index as 1.0 and scales only the income term at 1.2", () => {
    const nhs = UK_LAWS.find((l) => l.id === "uk.health.universalCare.primary")!;
    const at1 = computeLawCost(nhs.levels![4], UK_BASE, "UK", null);
    const atDefault = computeLawCost(nhs.levels![4], UK_BASE, "UK", undefined);
    const at12 = computeLawCost(nhs.levels![4], UK_BASE, "UK", 1.2);
    expect(atDefault.cost).toBe(at1.cost);
    expect(at12.cost).toBeCloseTo(at1.cost * 1.2, 0);

    const gdpLaw = UK_LAWS.find((l) => l.id === "uk.defense.armedForces.primary")!;
    const g1 = computeLawCost(gdpLaw.levels![3], UK_BASE, "UK", null);
    const g12 = computeLawCost(gdpLaw.levels![3], UK_BASE, "UK", 1.2);
    expect(g12.cost).toBe(g1.cost);
  });

  it("prices level 0 at zero cost and revenue", () => {
    const law = US_LAWS.find((l) => l.kind === "primary")!;
    const r = computeLawCost(law.levels![0], US_BASE, "US", null);
    expect(r).toEqual({ cost: 0, revenue: 0, net: 0 });
  });

  it("computes revenue and net for a revenue-bearing law", () => {
    const law = RU_LAWS.find((l) => l.id === "ru.environment.resourceDev.primary")!;
    const level = law.levels![3]; // gdp 0.0043, rev 0.0043
    const r = computeLawCost(level, RU_BASE, "RU", null);
    expect(r.revenue).toBeCloseTo(level.gdpRevenueFraction! * RU_BASE.gdp, 0);
    expect(r.net).toBeCloseTo(r.revenue - r.cost, 0);
  });
});
