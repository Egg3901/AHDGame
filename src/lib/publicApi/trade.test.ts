import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/trade/reconcileEmbargoes", () => ({
  resolveLegislatedEmbargoes: vi.fn(),
}));

describe("public trade queries", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["tariffs", "corporations", "tradeEmbargoes", "bills"].forEach((name) => db.collection(name));
  });

  it("resolves corporation tariff targets and keeps bill provenance", async () => {
    const corporationId = new ObjectId("507f1f77bcf86cd799439011");
    db.collectionMocks.tariffs!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId("507f1f77bcf86cd799439012"),
          countryId: "US",
          scopeType: "corporation",
          targetCorporationId: corporationId,
          rate: 15,
          sourceBillId: new ObjectId("507f1f77bcf86cd799439013"),
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        },
      ]),
    } as never);
    db.collectionMocks.corporations!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: corporationId, sequentialId: 42, name: "Acme" }]),
    } as never);

    const { queryTariffs } = await import("./trade");
    const result = await queryTariffs(db as unknown as Db, { country: "US" });

    expect(result.tariffs[0]).toMatchObject({
      countryId: "US",
      targetCorporation: { id: 42, name: "Acme" },
      rate: 15,
      sourceBillId: "507f1f77bcf86cd799439013",
    });
  });

  it("combines active stored and legislated embargoes without actor ids", async () => {
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    const { resolveLegislatedEmbargoes } = await import("@/lib/trade/reconcileEmbargoes");
    vi.mocked(getCurrentTurn).mockResolvedValue(100);
    vi.mocked(resolveLegislatedEmbargoes).mockReturnValue([
      {
        sourceCountry: "UK",
        targetCountry: "RU",
        commodity: "all",
        direction: "both",
        mode: "block",
        origin: "legislation",
        createdTurn: 90,
        sourceBillId: new ObjectId("507f1f77bcf86cd799439014"),
      },
    ] as never);
    db.collectionMocks.tradeEmbargoes!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId("507f1f77bcf86cd799439015"),
          sourceCountry: "US",
          targetCountry: "RU",
          commodity: "oil",
          direction: "export",
          mode: "cap",
          cap: 50,
          origin: "minister",
          expiresTurn: 120,
          createdTurn: 95,
          createdBy: new ObjectId("507f1f77bcf86cd799439016"),
        },
      ]),
    } as never);
    db.collectionMocks.bills!.find.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryTradeEmbargoes } = await import("./trade");
    const result = await queryTradeEmbargoes(db as unknown as Db);

    expect(result.embargoes).toHaveLength(2);
    expect(result.embargoes[0]).toMatchObject({ origin: "minister", cap: 50 });
    expect(result.embargoes[1]).toMatchObject({ origin: "legislation", sourceCountry: "UK" });
    expect(JSON.stringify(result)).not.toContain("createdBy");
  });
});
