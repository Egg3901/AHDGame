import { describe, it, expect } from "vitest";
import { metricCategories } from "@/lib/constants/metricDefinitions";
import { KNOWN_SPENDING_CATEGORIES } from "@/lib/constants/economicModels";
import {
  ESTATE_CATALOG,
  ESTATE_PORTFOLIO_BY_COUNTRY,
  FUNDING_LEVELS,
  TIER_MULTIPLIER,
  resolveEstatePortfolio,
  isAbroadSited,
  PORTFOLIO_BUDGET_CATEGORY,
  getPortfolioCatalog,
  getEstateArchetype,
  computeEffectiveOutput,
  computeEffectiveUpkeep,
  aggregateEstates,
} from "./cabinetEstates";
import type { CabinetEstate } from "@/lib/db/types/cabinetEstate";

const validPaths = new Set(
  metricCategories.flatMap((c) => c.metrics.map((m) => `${c.id}.${m.id}`))
);

function estate(p: Partial<CabinetEstate>): CabinetEstate {
  return {
    _id: undefined as never,
    countryId: "US",
    portfolioKey: "education",
    positionId: "secretary_of_education",
    archetypeId: "public_school",
    name: "Test",
    icon: "school",
    fundingLevel: "standard",
    tier: 0,
    condition: 100,
    outputBase: 1000,
    upkeepBase: 100,
    siteScope: "region",
    siteId: "US-CA",
    createdTurn: 1,
    ...p,
  };
}

describe("cabinetEstates catalog integrity", () => {
  it("every archetype effect path is a real metric path", () => {
    for (const [portfolio, archetypes] of Object.entries(ESTATE_CATALOG)) {
      for (const a of archetypes) {
        for (const path of Object.keys(a.effects)) {
          expect(validPaths.has(path), `${portfolio}/${a.id} → ${path}`).toBe(true);
        }
      }
    }
  });

  it("every in-scope position maps to a portfolio that has a catalog", () => {
    for (const seats of Object.values(ESTATE_PORTFOLIO_BY_COUNTRY)) {
      for (const portfolio of Object.values(seats!)) {
        expect(ESTATE_CATALOG[portfolio], `catalog for ${portfolio}`).toBeDefined();
        expect(ESTATE_CATALOG[portfolio].length).toBeGreaterThan(0);
      }
    }
  });

  it("abroad-sited archetypes only target national-style categories", () => {
    // These portfolios site their estates in HOST countries, so their effects
    // land at home nationally rather than on a home region. Region-scoped
    // categories (healthcare, education, publicSafety, …) have nowhere to land.
    const ok = new Set(["governance", "social", "economic", "population"]);
    for (const [portfolio, archetypes] of Object.entries(ESTATE_CATALOG)) {
      if (!isAbroadSited(portfolio)) continue;
      for (const a of archetypes) {
        for (const path of Object.keys(a.effects)) {
          expect(ok.has(path.split(".")[0]), `${portfolio} ${a.id} → ${path}`).toBe(true);
        }
      }
    }
  });

  it("every archetype icon key has a glyph", async () => {
    const { ICON_KEYS } =
      await import("@/app/country/[code]/executive/cabinet/[positionId]/office/components/estates/estatesUi");
    for (const [portfolio, archetypes] of Object.entries(ESTATE_CATALOG)) {
      for (const a of archetypes) {
        expect(ICON_KEYS.includes(a.icon), `${portfolio}/${a.id} → ${a.icon}`).toBe(true);
      }
    }
  });

  it("abroad-sited portfolios are foreign and trade_mission", () => {
    expect(isAbroadSited("foreign")).toBe(true);
    expect(isAbroadSited("trade_mission")).toBe(true);
    expect(isAbroadSited("education")).toBe(false);
    expect(isAbroadSited("heavy_industry")).toBe(false);
  });

  it("every mapped budget category is a real spending category", () => {
    for (const [portfolio, category] of Object.entries(PORTFOLIO_BUDGET_CATEGORY)) {
      expect(KNOWN_SPENDING_CATEGORIES.has(category), `${portfolio} → ${category}`).toBe(true);
    }
  });

  it("command-economy portfolios draw the same envelope as their market analogues", () => {
    // A Soviet agriculture or interior seat must size its budget off the same
    // appropriation its US/UK counterpart does, not the gdp-fraction fallback.
    expect(PORTFOLIO_BUDGET_CATEGORY.collective_farming).toBe(
      PORTFOLIO_BUDGET_CATEGORY.agriculture
    );
    expect(PORTFOLIO_BUDGET_CATEGORY.state_security).toBe(PORTFOLIO_BUDGET_CATEGORY.homeland);
  });
});

describe("resolveEstatePortfolio", () => {
  it("returns the portfolio key for an in-scope seat", () => {
    expect(resolveEstatePortfolio("US", "secretary_of_education")).toBe("education");
    expect(resolveEstatePortfolio("US", "secretary_of_state")).toBe("foreign");
  });
  it("returns null for reserved/unknown seats", () => {
    expect(resolveEstatePortfolio("US", "secretary_of_defense")).toBeNull();
    expect(resolveEstatePortfolio("US", "secretary_of_treasury")).toBeNull();
    expect(resolveEstatePortfolio("US", "secretary_of_energy")).toBeNull();
    expect(resolveEstatePortfolio("US", "nonsense")).toBeNull();
    expect(resolveEstatePortfolio("BR", "secretary_of_education")).toBeNull();
  });
});

describe("effective output/upkeep", () => {
  it("scales output by tier, funding, condition", () => {
    const base = computeEffectiveOutput(estate({ outputBase: 1000 }));
    expect(base).toBe(1000);
    const t2 = computeEffectiveOutput(estate({ outputBase: 1000, tier: 2 }));
    expect(t2).toBe(Math.round(1000 * TIER_MULTIPLIER[2]));
    const half = computeEffectiveOutput(estate({ outputBase: 1000, condition: 50 }));
    expect(half).toBe(500);
  });
  it("scales upkeep by tier and funding (not condition)", () => {
    expect(computeEffectiveUpkeep(estate({ upkeepBase: 100 }))).toBe(100);
    const enh = computeEffectiveUpkeep(estate({ upkeepBase: 100, fundingLevel: "enhanced" }));
    expect(enh).toBe(Math.round(100 * FUNDING_LEVELS.find((f) => f.id === "enhanced")!.upkeepMult));
  });
});

describe("aggregateEstates", () => {
  it("sums upkeep and groups effect deltas by site", () => {
    const agg = aggregateEstates([
      estate({ siteId: "US-CA", upkeepBase: 100 }),
      estate({ siteId: "US-CA", upkeepBase: 50, archetypeId: "university" }),
      estate({ siteId: "US-NY", upkeepBase: 40 }),
    ]);
    expect(agg.count).toBe(3);
    expect(agg.totalUpkeep).toBe(190);
    expect(Object.keys(agg.bySite).sort()).toEqual(["US-CA", "US-NY"]);
  });
  it("catalog/archetype lookups", () => {
    expect(getPortfolioCatalog("health").length).toBeGreaterThan(0);
    expect(getEstateArchetype("health", "hospital")?.id).toBe("hospital");
    expect(getEstateArchetype("health", "nope")).toBeUndefined();
  });
});

describe("calibration", () => {
  // MAX_PER_METRIC_MODIFIER_PER_TURN — the per-turn cap a metric delta is clamped to
  // (before ×CABINET_EFFECT_STRENGTH). A single maxed estate should sit at/under it so
  // it never alone overshoots; cross-estate stacking is the engine's clamp job.
  const CAP = 0.08;
  const enhancedMult =
    TIER_MULTIPLIER[3] * FUNDING_LEVELS.find((f) => f.id === "enhanced")!.outputMult; // 2.5 × 1.25

  it("no single maxed estate exceeds the per-metric cap", () => {
    for (const [portfolio, archetypes] of Object.entries(ESTATE_CATALOG)) {
      for (const a of archetypes) {
        for (const [path, base] of Object.entries(a.effects)) {
          const maxDelta = Math.abs(base) * enhancedMult; // tier 3 + enhanced + full condition
          expect(maxDelta, `${portfolio}/${a.id} ${path} = ${maxDelta}`).toBeLessThanOrEqual(CAP);
        }
      }
    }
  });

  it("archetype upkeep magnitudes are in a sane band (millions/turn)", () => {
    for (const archetypes of Object.values(ESTATE_CATALOG)) {
      for (const a of archetypes) {
        expect(a.upkeepBase).toBeGreaterThan(0);
        expect(a.upkeepBase).toBeLessThanOrEqual(200); // ≤ $200M/turn base before tier/funding
      }
    }
  });
});
