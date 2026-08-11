import { describe, it, expect } from "vitest";
import { metricCategories } from "@/lib/constants/metricDefinitions";
import {
  INFRA_ARCHETYPES,
  INFRA_POSITION_BY_COUNTRY,
  BUILD_FUNDING,
  resolveInfraPosition,
  getInfraArchetype,
  turnsRemaining,
  progressPct,
  aggregateInfra,
  INFRA_DISCRETIONARY_FRACTION,
} from "./cabinetInfra";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "./cabinetEstates";
import { ENERGY_POSITION_BY_COUNTRY } from "./cabinetEnergy";
import type { InfraProject } from "@/lib/db/types/infraProject";

const validPaths = new Set(
  metricCategories.flatMap((c) => c.metrics.map((m) => `${c.id}.${m.id}`))
);

function project(p: Partial<InfraProject>): InfraProject {
  return {
    _id: undefined as never,
    countryId: "US",
    positionId: "secretary_of_transportation",
    archetypeId: "highway",
    name: "P",
    icon: "road",
    regionId: "US-CA",
    status: "construction",
    progress: 0,
    buildDuration: 6,
    fundingLevel: "standard",
    outputBase: 500,
    upkeepBase: 40,
    constructionCostBase: 120,
    createdTurn: 1,
    ...p,
  };
}

describe("INFRA_ARCHETYPES + seat map integrity", () => {
  it("every archetype effect path is a real metric path", () => {
    for (const a of INFRA_ARCHETYPES) {
      for (const path of Object.keys(a.effects)) {
        expect(validPaths.has(path), `${a.id} → ${path}`).toBe(true);
      }
      expect(a.buildDuration).toBeGreaterThan(0);
    }
  });
  it("maps each transportation seat; never an Estates or Energy seat", () => {
    expect(resolveInfraPosition("US", "secretary_of_transportation")).toBe(
      "secretary_of_transportation"
    );
    expect(resolveInfraPosition("US", "secretary_of_energy")).toBeNull();
    for (const [cc, seat] of Object.entries(INFRA_POSITION_BY_COUNTRY)) {
      expect(
        ESTATE_PORTFOLIO_BY_COUNTRY[cc as keyof typeof ESTATE_PORTFOLIO_BY_COUNTRY]?.[seat!]
      ).toBeUndefined();
      expect(ENERGY_POSITION_BY_COUNTRY[cc as keyof typeof ENERGY_POSITION_BY_COUNTRY]).not.toBe(
        seat
      );
    }
  });
});

describe("helpers", () => {
  it("turnsRemaining scales by build funding speed", () => {
    expect(
      turnsRemaining(project({ progress: 0, buildDuration: 6, fundingLevel: "standard" }))
    ).toBe(6);
    expect(
      turnsRemaining(project({ progress: 0, buildDuration: 6, fundingLevel: "crashed" }))
    ).toBe(Math.ceil(6 / BUILD_FUNDING.find((f) => f.id === "crashed")!.speedMult));
  });
  it("progressPct clamps to 100", () => {
    expect(progressPct(project({ progress: 3, buildDuration: 6 }))).toBe(50);
    expect(progressPct(project({ progress: 9, buildDuration: 6 }))).toBe(100);
  });
  it("getInfraArchetype lookups", () => {
    expect(getInfraArchetype("highway")?.id).toBe("highway");
    expect(getInfraArchetype("nope")).toBeUndefined();
  });
});

describe("aggregateInfra", () => {
  it("splits building vs operational spend and groups by region", () => {
    const agg = aggregateInfra([
      project({
        status: "construction",
        regionId: "US-CA",
        constructionCostBase: 100,
        fundingLevel: "standard",
      }),
      project({ status: "operational", regionId: "US-CA", upkeepBase: 40 }),
      project({ status: "operational", regionId: "US-NY", upkeepBase: 25, archetypeId: "bridge" }),
    ]);
    expect(agg.building).toBe(1);
    expect(agg.operational).toBe(2);
    expect(agg.constructionSpend).toBe(100);
    expect(agg.operationalUpkeep).toBe(65);
    expect(agg.committedSpend).toBe(165);
    expect(agg.byRegion["US-CA"]).toEqual({ building: 1, operational: 1 });
  });
});

describe("calibration", () => {
  it("no archetype operational effect exceeds the per-metric cap", () => {
    const CAP = 0.08; // MAX_PER_METRIC_MODIFIER_PER_TURN (before ×CABINET_EFFECT_STRENGTH)
    for (const a of INFRA_ARCHETYPES) {
      for (const [path, base] of Object.entries(a.effects)) {
        expect(Math.abs(base), `${a.id} ${path}`).toBeLessThanOrEqual(CAP);
      }
    }
  });

  it("construction/upkeep magnitudes are in a sane band (millions/turn)", () => {
    for (const a of INFRA_ARCHETYPES) {
      expect(a.constructionCostBase).toBeGreaterThan(0);
      expect(a.constructionCostBase).toBeLessThanOrEqual(200);
      expect(a.upkeepBase).toBeGreaterThan(0);
      expect(a.upkeepBase).toBeLessThanOrEqual(200);
    }
  });

  it("a full operational fleet's committed spend fits inside the discretionary envelope", () => {
    // One operational of each archetype.
    const projects = INFRA_ARCHETYPES.map((a) =>
      project({
        archetypeId: a.id,
        status: "operational",
        upkeepBase: a.upkeepBase,
        constructionCostBase: a.constructionCostBase,
      })
    );
    const agg = aggregateInfra(projects);
    expect(agg.committedSpend).toBeGreaterThan(0);
    // US-scale transportation DISCRETIONARY envelope (gdp ~25T × 0.02 × the discretionary
    // fraction), in millions. A small starter fleet sits inside it; a built-up one exceeds it.
    const envelopeM = (25_000_000_000_000 * 0.02 * INFRA_DISCRETIONARY_FRACTION) / 1_000_000;
    expect(agg.committedSpend).toBeLessThan(envelopeM);
  });
});
