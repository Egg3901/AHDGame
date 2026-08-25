import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

import { getDb } from "@/lib/mongodb";
import { processCommodityPriceTurn } from "./commodityPriceTurn";

vi.mock("@/lib/market/featureFlag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market/featureFlag")>();
  return {
    ...actual,
    getMarketSystemMode: vi.fn().mockResolvedValue("off"),
    getDemographicsDemandEnabled: vi.fn().mockResolvedValue(false),
    getExtractionOutputScaleEnabled: vi.fn().mockResolvedValue(false),
    getHouseholdConsumptionEnabled: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("commodityPriceTurn sector currency anchoring", () => {
  let mockCollection: ReturnType<typeof vi.fn>;
  let mockBulkWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBulkWrite = vi.fn().mockResolvedValue({});
    mockCollection = vi.fn();
    vi.mocked(getDb).mockResolvedValue({ collection: mockCollection } as unknown as Db);
  });

  function createChainableCursor(data: unknown[]) {
    return {
      find: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(data),
    };
  }

  it("normalizes foreign-owned sector revenue at the host currency rate", async () => {
    const corporationId = new ObjectId();
    const positionalReads = [
      [
        {
          _id: new ObjectId(),
          corporationId,
          countryId: "FR",
          stateId: "FR-IDF",
          sectorType: "energy",
          revenue: 400,
          strategyId: null,
          transitionFromStrategyId: null,
          transitionStartTurn: null,
        },
      ],
      [],
      [
        {
          _id: corporationId,
          countryId: "US",
          liquidCurrencyCode: "USD",
          countryOwnerId: null,
          marketingBudget: 0,
          headquartersState: "US-CA",
        },
      ],
      [],
      [{ _id: "FR-IDF", countryId: "FR", gdp: 1_000_000 }],
      [],
      [],
      [
        { currencyCode: "USD", rate: 1 },
        { currencyCode: "FRF", rate: 400 },
      ],
      [],
      [],
      [],
    ];

    for (const data of positionalReads) {
      mockCollection.mockReturnValueOnce(createChainableCursor(data));
    }
    mockCollection.mockReturnValue({
      bulkWrite: mockBulkWrite,
      insertMany: vi.fn().mockResolvedValue({ insertedIds: [] }),
      updateOne: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({}),
      createIndex: vi.fn().mockResolvedValue(""),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue(createChainableCursor([])),
    });

    await processCommodityPriceTurn(100);

    const commodityOps = mockBulkWrite.mock.calls[0][0];
    const energyOp = commodityOps.find(
      (op: { updateOne?: { filter?: { commodity?: string } } }) =>
        op.updateOne?.filter?.commodity === "energy"
    );

    // 400 host-local at 400 FRF/anchor is ₳1. At the energy output rate,
    // that contributes 0.01 rounded ledger units, not the 4.33 units produced
    // by treating the sector as owner-denominated USD.
    expect(energyOp.updateOne.update.$set.stateSupply["FR-IDF"]).toBe(0.01);
  });
});
