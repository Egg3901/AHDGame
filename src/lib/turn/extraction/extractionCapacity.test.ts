import { describe, it, expect } from "vitest";
import { computeExtractionCapacityMultipliers } from "./extractionCapacity";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import { ObjectId } from "mongodb";

function makeCapacity(
  stateId: string,
  resources: Partial<Record<ExtractableResource, number>>
): StateResourceCapacity {
  return {
    _id: new ObjectId(),
    stateId,
    countryId: "US",
    resources,
    updatedAt: new Date(),
  };
}

function makeContract(
  stateId: string,
  corporationId: ObjectId,
  resource: ExtractableResource,
  share: number
): ExtractionContract {
  return {
    _id: new ObjectId(),
    stateId,
    countryId: "US",
    corporationId,
    resource,
    share,
    grantedTurn: 1,
    grantedBy: "state-legislature",
    grantedByLevel: "state",
    updatedAt: new Date(),
  };
}

const corp1 = new ObjectId();
const corp2 = new ObjectId();

describe("computeExtractionCapacityMultipliers", () => {
  it("returns multiplier 1 for all sectors when no capacity docs exist", () => {
    const sectors = [
      { sectorId: "s1", stateId: "TX", corporationId: corp1, revenueBasedOutput: { oil: 10000 } },
    ];
    const result = computeExtractionCapacityMultipliers(sectors, [], []);
    expect(result.get("s1")?.oil).toBe(1);
  });

  it("returns multiplier 1 when open-access output is below pool", () => {
    const sectors = [
      { sectorId: "s1", stateId: "TX", corporationId: corp1, revenueBasedOutput: { oil: 5000 } },
    ];
    const capacities = [makeCapacity("TX", { oil: 10000 })];
    const result = computeExtractionCapacityMultipliers(sectors, [], capacities);
    expect(result.get("s1")?.oil).toBe(1);
  });

  it("scales open-access sectors proportionally when demand exceeds pool", () => {
    const sectors = [
      { sectorId: "s1", stateId: "TX", corporationId: corp1, revenueBasedOutput: { oil: 8000 } },
      { sectorId: "s2", stateId: "TX", corporationId: corp2, revenueBasedOutput: { oil: 8000 } },
    ];
    const capacities = [makeCapacity("TX", { oil: 10000 })];
    const result = computeExtractionCapacityMultipliers(sectors, [], capacities);
    // totalOADemand=16000, pool=10000, multiplier=10000/16000=0.625
    expect(result.get("s1")?.oil).toBeCloseTo(0.625);
    expect(result.get("s2")?.oil).toBeCloseTo(0.625);
  });

  it("caps contract-holder output at contracted capacity", () => {
    const sectors = [
      { sectorId: "s1", stateId: "TX", corporationId: corp1, revenueBasedOutput: { oil: 80000 } },
    ];
    const capacities = [makeCapacity("TX", { oil: 100000 })];
    const contracts = [makeContract("TX", corp1, "oil", 0.5)];
    const result = computeExtractionCapacityMultipliers(sectors, contracts, capacities);
    // allocatedCap = 100000 × 0.5 = 50000; revenueOutput = 80000; multiplier = 50000/80000 = 0.625
    expect(result.get("s1")?.oil).toBeCloseTo(0.625);
  });

  it("does not cap contract-holder when revenue output is below contracted capacity", () => {
    const sectors = [
      { sectorId: "s1", stateId: "TX", corporationId: corp1, revenueBasedOutput: { oil: 20000 } },
    ];
    const capacities = [makeCapacity("TX", { oil: 100000 })];
    const contracts = [makeContract("TX", corp1, "oil", 0.5)];
    const result = computeExtractionCapacityMultipliers(sectors, contracts, capacities);
    // allocatedCap = 50000; output = 20000; 20000 < 50000 → multiplier = 1
    expect(result.get("s1")?.oil).toBe(1);
  });

  it("squeezes open-access to zero when contracts over-allocate", () => {
    const sectors = [
      // corp1 has 60% contract
      { sectorId: "s1", stateId: "TX", corporationId: corp1, revenueBasedOutput: { oil: 5000 } },
      // corp2 has 50% contract
      { sectorId: "s2", stateId: "TX", corporationId: corp2, revenueBasedOutput: { oil: 5000 } },
      // corp3 open-access — squeezed out
      {
        sectorId: "s3",
        stateId: "TX",
        corporationId: new ObjectId(),
        revenueBasedOutput: { oil: 5000 },
      },
    ];
    const capacities = [makeCapacity("TX", { oil: 100000 })];
    const contracts = [
      makeContract("TX", corp1, "oil", 0.6),
      makeContract("TX", corp2, "oil", 0.5),
    ];
    const result = computeExtractionCapacityMultipliers(sectors, contracts, capacities);
    expect(result.get("s3")?.oil).toBe(0); // open-access pool = max(0, 1 - 1.1) = 0
  });

  it("resolves each resource independently", () => {
    const sectors = [
      {
        sectorId: "s1",
        stateId: "TX",
        corporationId: corp1,
        revenueBasedOutput: { oil: 80000, coal: 5000 },
      },
    ];
    const capacities = [makeCapacity("TX", { oil: 100000, coal: 20000 })];
    const contracts = [makeContract("TX", corp1, "oil", 0.5)]; // oil contract only
    const result = computeExtractionCapacityMultipliers(sectors, contracts, capacities);
    expect(result.get("s1")?.oil).toBeCloseTo(0.625); // capped by contract
    expect(result.get("s1")?.coal).toBe(1); // open-access, within pool
  });
});
