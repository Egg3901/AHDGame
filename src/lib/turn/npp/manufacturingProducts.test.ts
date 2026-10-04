import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import { sectorCapacityBookAnchor } from "@/lib/corporations/sectorProfitBasis";
import {
  createNppManufacturingProductProjectV2,
  buildNppProductProjectsV2,
  type loadNppProductProjectsV2,
} from "./manufacturingProducts";

describe("NPP product project selection", () => {
  const corporationId = new ObjectId().toString();
  const sectorId = new ObjectId().toString();
  const sector = {
    _id: new ObjectId(sectorId),
    corporationId: new ObjectId(corporationId),
    sectorType: "manufacturing",
    strategyId: "electronics_manufacturing",
    capitalStock: 500,
    capacityBookAnchor: 50_000,
    plantCount: 2,
    revenue: 10_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    mothballed: false,
  } as unknown as CorporateSector;
  const corporation = {
    _id: new ObjectId(corporationId),
    unlockedTechNodeIds: [],
  };

  it("starts a legal project from actual plant capacity and current strategy mix", () => {
    const state = {
      plantsEnabled: true,
      productLinesEnabled: true,
      activeProjectByCorporationId: new Map(),
    } as Awaited<ReturnType<typeof loadNppProductProjectsV2>>;

    const projects = buildNppProductProjectsV2({
      state,
      nppCorporations: [corporation],
      sectorsByCorp: new Map([[corporationId, [sector]]]),
      turn: 10,
      techCurrentYear: 1953,
      techTreesEnabled: false,
      plants: { enabled: true, eraUnitScale: 1 },
      priceRatioOf: () => 2,
    });

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      corporationId,
      activeCorporationId: corporationId,
      stage: "development",
      allocations: [{ sectorId, share: 1 }],
      paidThresholdAnchor: 2500,
      elapsedThresholdTurns: 12,
    });
    expect(["consumer_electronics", "industrial_electronics", "electronic_components"]).toContain(
      projects[0].kindId
    );
  });

  it("uses the same era-priced fallback when a selected NPP plant has no stored capital value", () => {
    const legacy = { ...sector, capacityBookAnchor: undefined };
    const project = createNppManufacturingProductProjectV2({
      corporationId,
      sectors: [legacy],
      turn: 10,
      currentYear: 1991,
      techTreesEnabled: false,
      eraUnitScale: 1,
      priceRatioOf: () => 2,
    });
    expect(project?.paidThresholdAnchor).toBeCloseTo(
      sectorCapacityBookAnchor(legacy, 1991, 1) * 0.05
    );
    expect(project?.paidThresholdAnchor).not.toBe(25);
  });

  it("does not replace an active project or select while the feature gate is off", () => {
    const activeProject = { _id: "existing" } as never;
    const base = {
      nppCorporations: [corporation],
      sectorsByCorp: new Map([[corporationId, [sector]]]),
      turn: 10,
      techCurrentYear: 1953,
      techTreesEnabled: false,
      plants: { enabled: true, eraUnitScale: 1 },
      priceRatioOf: () => 2,
    };

    expect(
      buildNppProductProjectsV2({
        ...base,
        state: {
          plantsEnabled: true,
          productLinesEnabled: true,
          activeProjectByCorporationId: new Map([[corporationId, activeProject]]),
        } as Awaited<ReturnType<typeof loadNppProductProjectsV2>>,
      })
    ).toEqual([]);
    expect(
      buildNppProductProjectsV2({
        ...base,
        state: {
          plantsEnabled: true,
          productLinesEnabled: false,
          activeProjectByCorporationId: new Map(),
        } as Awaited<ReturnType<typeof loadNppProductProjectsV2>>,
      })
    ).toEqual([]);
  });
});
