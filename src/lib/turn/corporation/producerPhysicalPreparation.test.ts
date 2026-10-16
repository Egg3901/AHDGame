import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import { makeCorporation } from "@/lib/test-utils/factories";
import {
  prepareProducerPhysicalSector,
  type ProducerPhysicalEnv,
} from "./producerPhysicalPreparation";

function fixture() {
  const corporation = makeCorporation({ countryId: "US", liquidCurrencyCode: "USD" });
  const sector: CorporateSector = {
    _id: new ObjectId(),
    corporationId: corporation._id,
    countryId: "US",
    stateId: "CA",
    sectorType: "financial",
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    revenue: 999999,
    profitMargin: 99,
    workers: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    capitalStock: 240,
    capacityBookAnchor: 100,
    buildQueue: [],
    producerCapacity: { worldEpoch: "world", turn: 0 },
    producerInventory: { worldEpoch: "world", turn: 0, inputStock: [], outputStock: [] },
  };
  const env: ProducerPhysicalEnv = {
    currentTurn: 1,
    currentYear: 1991,
    techTreesEnabled: false,
    labour: { wagesEnabled: true, unionsEnabled: false, fullEnabled: false },
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    pendingStrikeEvents: [],
    labourDemandByState: new Map(),
    lookups: {
      preset: "1991-default",
      eraUnitScale: 1,
      labourTightnessByState: new Map(),
      stateResourceCapacityByState: new Map(),
      priceRatioByCommodity: new Map(),
      activeDisasterEffectsByState: new Map(),
      rawWorkforceSkillByState: new Map(),
      extractionCapacityUtilBySector: new Map(),
    },
  };
  const input = { worldEpoch: "world", env, corporation, sector, inputPriceHeadroom: 1.25 };
  return { input, env, sector };
}

describe("physical producer preparation", () => {
  it("keeps staff and capacity independent of quotes, recorded revenue and last turn's fill", () => {
    const { input, sector } = fixture();
    const first = prepareProducerPhysicalSector(input);
    sector.revenue = 0;
    sector.profitMargin = -100;
    sector.soldUnits = 0;
    sector.producerQuotes = { financial_services: { kind: "manual", unitPrice: 9999 } };
    const second = prepareProducerPhysicalSector(input);
    expect(second.prepared.plan.capacityUnits).toBe(first.prepared.plan.capacityUnits);
    expect(second.prepared.plan.outputMultiplier).toBe(first.prepared.plan.outputMultiplier);
    expect(second.prepared.plan.labourCost).toBe(first.prepared.plan.labourCost);
    expect(second.prepared.plan.otherOperatingCost).toBe(first.prepared.plan.otherOperatingCost);
    expect(second.headcount).toEqual(first.headcount);
    expect(
      second.prepared.plan.outputs.find((output) => output.commodity === "financial_services")
        ?.policy
    ).toEqual({ kind: "manual", unitPrice: 9999 });
  });

  it("prices work on the base value of actual owned output, independently of market quotes", () => {
    const { input, env } = fixture();
    const {
      prepared: { plan },
    } = prepareProducerPhysicalSector(input);
    const outputValue =
      plan.capacityUnits *
      plan.outputs.reduce(
        (sum, output) => sum + output.unitsPerOutput * output.referenceUnitPrice,
        0
      );
    expect(plan.labourCost).toBeCloseTo(outputValue * 0.44, 8);
    expect(plan.otherOperatingCost).toBeCloseTo(outputValue * 0.04, 8);
    env.lookups.priceRatioByCommodity.set("financial_services", 2);
    const changed = prepareProducerPhysicalSector(input).prepared.plan;
    expect(changed.capacityUnits).toBe(plan.capacityUnits);
    expect(changed.labourCost).toBe(plan.labourCost);
    expect(changed.otherOperatingCost).toBe(plan.otherOperatingCost);
    expect(changed.outputs[0].referenceUnitPrice).toBe(plan.outputs[0].referenceUnitPrice * 2);
  });

  it("retains a smaller cold-site bill while mothballing stops jobs and output", () => {
    const { input, sector } = fixture();
    const running = prepareProducerPhysicalSector(input);
    sector.mothballed = true;
    const parked = prepareProducerPhysicalSector(input);
    expect(parked.prepared.plan.activeFraction).toBe(0);
    expect(parked.prepared.plan.labourCost).toBe(0);
    expect(parked.prepared.plan.otherOperatingCost).toBeGreaterThan(0);
    expect(parked.prepared.plan.otherOperatingCost).toBeLessThan(
      running.prepared.plan.otherOperatingCost
    );
    expect(parked.prepared.target.capacity).toEqual(running.prepared.target.capacity);
  });

  it("charges only the staffed workforce when a state cannot fill all jobs", () => {
    const { input, env, sector } = fixture();
    const full = prepareProducerPhysicalSector(input);
    env.lookups.labourTightnessByState.set(sector.stateId, 2);
    sector.labourStaffingFactor = 0.5;
    const short = prepareProducerPhysicalSector(input);
    expect(short.staffingFactor).toBeCloseTo(0.5);
    expect(short.headcount.workers).toBeCloseTo(full.headcount.workers / 2);
    expect(short.prepared.plan.labourCost).toBeCloseTo(full.prepared.plan.labourCost / 2);
  });

  it("separates a physical halt from the bills an active workforce still incurs", () => {
    const { input, env, sector } = fixture();
    const running = prepareProducerPhysicalSector(input);
    env.lookups.activeDisasterEffectsByState.set(sector.stateId, [
      {
        value: -100,
        startTurn: 1,
        durationTurns: 10,
        sectorType: null,
        strategyId: null,
        physicality: "physical",
      },
    ]);
    const halted = prepareProducerPhysicalSector(input);
    expect(halted.prepared.plan.outputMultiplier).toBe(0);
    expect(halted.prepared.plan.labourCost).toBe(running.prepared.plan.labourCost);
    expect(halted.prepared.plan.otherOperatingCost).toBe(running.prepared.plan.otherOperatingCost);
  });

  it("requires actual resource and unit-basis reconciliation instead of granting output", () => {
    const { input, sector, env } = fixture();
    sector.sectorType = "extraction";
    expect(() => prepareProducerPhysicalSector(input)).toThrow("resource opening");
    env.lookups.stateResourceCapacityByState.set(sector.stateId, {});
    const empty = prepareProducerPhysicalSector(input);
    expect(empty.prepared.plan.outputMultiplier).toBe(0);
    sector.transitionFromStrategyId = "oil_gas";
    expect(() => prepareProducerPhysicalSector(input)).toThrow("owned-unit basis");
  });
});
