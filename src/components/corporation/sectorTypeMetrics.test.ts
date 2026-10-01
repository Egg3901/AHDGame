import { describe, expect, it } from "vitest";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { proposedSectorActions } from "@/lib/constants/sectorTypeDossier";
import type { SectorDetail } from "./CorporationPageTypes";
import {
  sectorTypeMetrics,
  sprawlRelief,
  typeCapacityUsed,
  resolveSectorStrategy,
  typeDepositCapacity,
  typeFacilityCount,
  typeFillRate,
  typeFossilShare,
  typeMarketShare,
  typeOutputMix,
} from "./sectorTypeMetrics";

function sector(over: Partial<SectorDetail> & Pick<SectorDetail, "sectorType">): SectorDetail {
  return {
    _id: over._id ?? Math.random().toString(36).slice(2),
    stateId: "OH",
    stateName: "Ohio",
    sectorLabel: "Sector",
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    revenue: 1_000_000,
    financialRevenue: 1_000_000,
    realizedRevenue: 1_000_000,
    profitMargin: 10,
    effectiveProfitMargin: 10,
    marketSharePercent: 10,
    unemploymentModifier: 0,
    gridReliabilityModifier: 0,
    corruptionModifier: 0,
    workforceSkillModifier: null,
    crimeRateModifier: null,
    broadbandModifier: null,
    roadConditionModifier: null,
    carbonEmissionsModifier: null,
    costOfLivingModifier: null,
    commodityModifier: 0,
    homeLocationModifier: 0,
    stateSectorSpecializationModifier: 0,
    inflationModifier: 0,
    debtToGdpModifier: 0,
    deficitToGdpModifier: 0,
    foreignTariffModifier: 0,
    domesticTariffMalus: 0,
    profit: 100_000,
    workers: 1_000,
    ...over,
  } as SectorDetail;
}

// 24 sectors is past the sprawl threshold of 15, so there is a penalty for
// logistics strength to buy back; at 100 the threshold stretches to 22.5 and
// the corp drops out of the penalty entirely.
const context = {
  plantsMode: true,
  totalSectors: 24,
  logisticsStrength: 100,
  hasSecondaryType: false,
};

describe("typeCapacityUsed", () => {
  it("is Σproduced over Σcapacity, not the mean of the row ratios", () => {
    const sectors = [
      sector({ sectorType: "manufacturing", capacityUnits: 10_000, producedUnits: 10_000 }),
      sector({ sectorType: "manufacturing", capacityUnits: 90_000, producedUnits: 45_000 }),
    ];
    // Mean of ratios would be 75%. The corp is actually running 55% of its lines.
    expect(typeCapacityUsed(sectors)).toBeCloseTo(0.55);
  });

  it("is null when nothing carries capacity (below the plants tier)", () => {
    expect(typeCapacityUsed([sector({ sectorType: "media" })])).toBeNull();
  });
});

describe("typeFillRate", () => {
  it("is Σsold over Σproduced", () => {
    const sectors = [
      sector({ sectorType: "retail", producedUnits: 1_000, soldUnits: 900 }),
      sector({ sectorType: "retail", producedUnits: 3_000, soldUnits: 1_500 }),
    ];
    expect(typeFillRate(sectors)).toBeCloseTo(0.6);
  });

  it("is null when nothing was produced", () => {
    expect(typeFillRate([sector({ sectorType: "retail", producedUnits: 0 })])).toBeNull();
  });
});

describe("typeOutputMix", () => {
  it("reads the dominant commodity off each sector's ACTIVE strategy", () => {
    // Heavy Metals produces steel and nothing else.
    const mix = typeOutputMix([
      sector({ sectorType: "manufacturing", strategyId: "heavy_metals", capacityUnits: 1_000 }),
    ]);
    expect(mix?.commodity).toBe("steel");
    expect(mix?.share).toBeCloseTo(1);
  });

  it("weights by capacity, so the bigger plant moves the mix", () => {
    const mix = typeOutputMix([
      sector({ sectorType: "manufacturing", strategyId: "heavy_metals", capacityUnits: 100 }),
      sector({
        sectorType: "manufacturing",
        strategyId: "electronics_manufacturing",
        capacityUnits: 100_000,
      }),
    ]);
    // Electronics Manufacturing leads on electronics and dwarfs the other site.
    expect(mix?.commodity).toBe("electronics");
  });

  it("falls back to the standard strategy for a sector with no strategyId", () => {
    const mix = typeOutputMix([sector({ sectorType: "manufacturing", capacityUnits: 1_000 })]);
    expect(mix?.commodity).toBe("steel");
    // Standard makes building materials too, so steel is not the whole output.
    expect(mix?.share).toBeLessThan(1);
  });
});

describe("resolveSectorStrategy", () => {
  it("resolves a stored id the type no longer has the way the engine does", () => {
    const stale = sector({ sectorType: "manufacturing", strategyId: "a_removed_method" });
    // getStrategy falls back to the type's first strategy; the panel and this
    // module must agree with it or a site goes missing from one of them.
    expect(resolveSectorStrategy(stale)?.id).toBe(SECTOR_STRATEGIES.manufacturing[0].id);
  });

  it("still counts a sector on a removed strategy in the output mix", () => {
    const mix = typeOutputMix([
      sector({ sectorType: "manufacturing", strategyId: "a_removed_method", capacityUnits: 1_000 }),
    ]);
    expect(mix).not.toBeNull();
  });

  it("is null for a type with no strategy table at all", () => {
    expect(resolveSectorStrategy(sector({ sectorType: "not_a_type" as never }))).toBeNull();
  });
});

describe("typeFossilShare", () => {
  it("counts coal, oil and gas against the whole input basket", () => {
    const conventional = typeFossilShare([
      sector({ sectorType: "energy", strategyId: "standard", capacityUnits: 1_000 }),
    ]);
    const renewable = typeFossilShare([
      sector({ sectorType: "energy", strategyId: "renewables", capacityUnits: 1_000 }),
    ]);
    expect(conventional).not.toBeNull();
    expect(renewable).not.toBeNull();
    // Renewables buys electronics and rare earths, so it must sit lower.
    expect(renewable!).toBeLessThan(conventional!);
    expect(renewable!).toBeCloseTo(0);
  });
});

describe("proposed sector actions", () => {
  it("gives every sector type exactly two levers, so no dossier renders an empty action row", () => {
    for (const type of CORPORATION_TYPES) {
      const actions = proposedSectorActions(type);
      expect(actions, type).toHaveLength(2);
      for (const action of actions) {
        expect(action.label.length, `${type} label`).toBeGreaterThan(0);
        expect(action.help.length, `${type} help`).toBeGreaterThan(0);
      }
    }
  });

  it("carries no em or en dashes, which player-facing copy forbids", () => {
    for (const type of CORPORATION_TYPES) {
      for (const action of proposedSectorActions(type)) {
        expect(`${action.label} ${action.help}`, type).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("typeFacilityCount", () => {
  it("counts plants, not the sectors that hold them", () => {
    expect(
      typeFacilityCount([
        sector({ sectorType: "manufacturing", plantCount: 4 }),
        sector({ sectorType: "manufacturing", plantCount: 3 }),
      ])
    ).toBe(7);
  });

  it("falls back to one per sector below the plants tier", () => {
    expect(
      typeFacilityCount([sector({ sectorType: "media" }), sector({ sectorType: "media" })])
    ).toBe(2);
  });
});

describe("typeMarketShare", () => {
  it("weights share by capacity so a token site cannot drag the headline", () => {
    const share = typeMarketShare([
      sector({ sectorType: "retail", marketSharePercent: 60, capacityUnits: 9_000 }),
      sector({ sectorType: "retail", marketSharePercent: 10, capacityUnits: 1_000 }),
    ]);
    expect(share).toBeCloseTo(55);
  });
});

describe("typeDepositCapacity", () => {
  it("counts a state's reserves once however many mines sit on them", () => {
    const resources = { coal: 500, iron: 200 };
    const capacity = typeDepositCapacity([
      sector({
        sectorType: "extraction",
        strategyId: "coal_mining",
        stateId: "WY",
        stateResources: resources,
      }),
      sector({
        sectorType: "extraction",
        strategyId: "coal_mining",
        stateId: "WY",
        stateResources: resources,
      }),
    ]);
    // Coal Mining extracts coal only, and both mines share the Wyoming ground.
    expect(capacity).toBe(500);
  });

  it("is null when no sector carries a state resource document", () => {
    expect(
      typeDepositCapacity([sector({ sectorType: "extraction", strategyId: "coal_mining" })])
    ).toBeNull();
  });
});

describe("sprawlRelief", () => {
  it("is the penalty logistics strength buys back at the corp's sector count", () => {
    const relieved = sprawlRelief(context);
    expect(relieved).toBeGreaterThan(0);
    // With no logistics there is nothing to buy back.
    expect(sprawlRelief({ ...context, logisticsStrength: 0 })).toBe(0);
  });
});

describe("sectorTypeMetrics", () => {
  it("keeps the design's labels for the slots the game can actually compute", () => {
    const metrics = sectorTypeMetrics(
      [sector({ sectorType: "manufacturing", capacityUnits: 1_000, producedUnits: 930 })],
      "manufacturing",
      context
    );
    expect(metrics.map((m) => m.label)).toEqual(["Line utilisation", "Output mix", "Jobs"]);
    expect(metrics[0].value).toBe("93%");
  });

  it("gives logistics all three of its designed metrics", () => {
    const metrics = sectorTypeMetrics(
      [sector({ sectorType: "logistics", capacityUnits: 26_000 })],
      "logistics",
      context
    );
    expect(metrics.map((m) => m.label)).toEqual([
      "Freight capacity",
      "Network coverage",
      "Sprawl relief",
    ]);
    expect(metrics[0].value).toBe("26k");
    expect(metrics[1].value).toBe("1 state");
  });

  it("falls back to a live trio for a type the design never covered", () => {
    const metrics = sectorTypeMetrics(
      [sector({ sectorType: "telecommunications", capacityUnits: 100, producedUnits: 50 })],
      "telecommunications",
      context
    );
    expect(metrics.map((m) => m.label)).toEqual(["Capacity used", "Fill rate", "Jobs"]);
  });

  it("swaps to growth-tier metrics below the plants tier, where capacity does not exist", () => {
    const metrics = sectorTypeMetrics(
      [sector({ sectorType: "manufacturing", targetGrowthRate: 6 })],
      "manufacturing",
      { ...context, plantsMode: false }
    );
    expect(metrics.map((m) => m.label)).toEqual(["Growth target", "Market share", "Jobs"]);
    expect(metrics[0].value).toBe("6.0%");
  });
});
