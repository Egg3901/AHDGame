import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { moveSectorToCorp } from "./moveSector";

vi.mock("@/lib/market/featureFlag", async (original) => ({
  ...(await original<typeof import("@/lib/market/featureFlag")>()),
  getMarketSystemModeForDb: vi.fn(async () => "plants"),
}));

describe("producer property during agreed acquisitions", () => {
  it("moves paid plant basis and both inventory books without converting their anchor values", async () => {
    const memory = createInMemoryDb();
    const owner = new ObjectId(),
      buyer = new ObjectId();
    const sector = (
      corporationId: ObjectId,
      units: number,
      basis: number,
      inputValue: number
    ): CorporateSector => ({
      _id: new ObjectId(),
      corporationId,
      countryId: "US",
      stateId: "CA",
      sectorType: "energy",
      strategyId: "standard",
      revenue: 0,
      workers: 0,
      profitMargin: 0,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      capitalStock: units,
      capacityBookAnchor: basis,
      buildQueue: [],
      producerCapacity: { worldEpoch: "world", turn: 4 },
      producerInventory: {
        worldEpoch: "world",
        turn: 4,
        inputStock: [{ commodity: "fuel", units: 10, value: inputValue }],
        outputStock: [{ commodity: "steel", book: "world", units: 5, quoteUnitCost: 2 }],
      },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    const source = sector(owner, 200, 150, 20),
      destination = sector(buyer, 400, 350, 30);
    memory.seed("corporateSectors", [source, destination]);
    await moveSectorToCorp(
      memory as unknown as Db,
      source,
      buyer,
      "JPY",
      100,
      "USD",
      2,
      new Date(0)
    );
    const docs = memory.collection("corporateSectors").docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      capacityBookAnchor: 500,
      capitalStock: 600,
      producerCapacity: { worldEpoch: "world", turn: 4 },
      producerInventory: {
        worldEpoch: "world",
        turn: 4,
        inputStock: [{ commodity: "fuel", units: 20, value: 50 }],
        outputStock: [{ commodity: "steel", book: "world", units: 10, quoteUnitCost: 2 }],
      },
    });
    expect(memory.collection("ledgerEntries").docs).toHaveLength(0);
  });
});
