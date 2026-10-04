import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { GET } from "./route";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/mongodb", () => ({ getDb: getDbMock }));
vi.mock("@/lib/politicalLegislation/estimates", () => ({
  attachPoliticalLegislationEstimates: vi.fn(async (_db, types) => types),
}));

describe("GET /api/game/legislation-types media ownership availability", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    for (const collection of [
      "gameState",
      "gameConfig",
      "legislationTypes",
      "corporateSectors",
      "bankMoneyMoves",
    ]) {
      db.collection(collection);
    }
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      sort: () => ({
        toArray: async () => [
          {
            _id: "us_media_communications",
            name: "Media and Communications Regulation Act",
            countryScope: "us",
          },
          { _id: "us_income_tax", name: "Income Tax Act", countryScope: "us" },
        ],
      }),
    } as never);
    getDbMock.mockResolvedValue(db);
  });

  it("keeps existing law choices and avoids market reads when disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      mediaRegulationSnapshot: {
        enabled: false,
        marketSystemMode: "clearing",
        commandEconomyEnabled: false,
      },
    });

    const response = await GET(
      new Request("http://localhost/api/game/legislation-types?country=us&nocache=1")
    );
    const types = (await response.json()) as Array<{ _id: string }>;

    expect(types.map((type) => type._id)).toContain("us_media_communications");
    expect(db.collectionMocks.corporateSectors.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.gameConfig.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.bankMoneyMoves.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.gameState.findOne).toHaveBeenCalledOnce();
  });

  it("hides ownership legislation below measured concentration", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
      currentYear: 1991,
      mediaRegulationSnapshot: {
        enabled: true,
        marketSystemMode: "clearing",
        commandEconomyEnabled: false,
      },
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] } as never);

    const response = await GET(
      new Request("http://localhost/api/game/legislation-types?country=us&nocache=1")
    );
    const types = (await response.json()) as Array<{ _id: string }>;

    expect(types.map((type) => type._id)).not.toContain("us_media_communications");
    expect(types.map((type) => type._id)).toContain("us_income_tax");
    expect(db.collectionMocks.corporateSectors.find).toHaveBeenCalledOnce();
  });
});
