import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 10, currentYear: 1953 }),
}));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(10) }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn().mockResolvedValue({ ok: true, user: { userId: "ceo-1" } }),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn((corporation, userId) =>
    corporation.userId?.toString() === userId ? null : new Response(null, { status: 403 })
  ),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));

const cursor = (rows: unknown[]) => ({
  project: vi.fn().mockReturnThis(),
  toArray: vi.fn().mockResolvedValue(rows),
});

let db: MockDb;
let corporationId: ObjectId;
let sectorId: ObjectId;
let sectors: object[];

beforeEach(async () => {
  vi.clearAllMocks();
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 10, currentYear: 1953 } as never);
  db = createMockDb();
  for (const collection of [
    "gameConfig",
    "corporateSectors",
    "manufacturingProductProjectsV2",
    "gameState",
  ])
    db.collection(collection);
  corporationId = new ObjectId();
  sectorId = new ObjectId();
  sectors = [
    {
      _id: sectorId,
      corporationId,
      sectorType: "automobiles",
      strategyId: "standard",
      capitalStock: 1000,
      capacityBookAnchor: 50_000,
      plantCount: 2,
      mothballed: false,
    },
  ];
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: corporationId, userId: "ceo-1", unlockedTechNodeIds: [] },
  } as never);
  db.collectionMocks.gameConfig.findOne.mockResolvedValue({
    _id: "default",
    marketSystemMode: "plants",
    productLinesV2Enabled: false,
  });
  db.collectionMocks.corporateSectors.find.mockReturnValue(cursor(sectors));
  db.collectionMocks.manufacturingProductProjectsV2.findOne.mockResolvedValue(null);
  db.collectionMocks.manufacturingProductProjectsV2.insertOne.mockResolvedValue({
    acknowledged: true,
  } as never);
});

describe("manufacturing product project routes", () => {
  it("does not query the v2 project collection while the gate is off", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/1/products"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, isCeo: true });
    expect(db.collectionMocks.manufacturingProductProjectsV2.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.manufacturingProductProjectsV2.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.find).not.toHaveBeenCalled();
    const { getGameState } = await import("@/lib/gameState");
    expect(getGameState).not.toHaveBeenCalled();
  });

  it("returns project-specific settled sales, quality, and actual strategy tech requirements", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
      productLinesV2Enabled: true,
    });
    sectors = [
      {
        ...sectors[0],
        outputUnitsByCommodity: { vehicles: 80, steel: 20 },
        productQualityByCommodity: { vehicles: 72 },
        soldByCommodity: { vehicles: 0.75 },
        soldByCommodityTurn: 12,
        productLineProjectId: "product-1",
        productLineOutputTurn: 12,
        productLineOutputUnitsByCommodity: { vehicles: 20 },
        productLineSoldUnitsByCommodity: { vehicles: 10 },
        productLineQualityByCommodity: { vehicles: 72 },
      },
    ];
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor(sectors));
    db.collectionMocks.manufacturingProductProjectsV2.findOne.mockResolvedValue({
      _id: "product-1",
      corporationId: corporationId.toString(),
      activeCorporationId: corporationId.toString(),
      kindId: "passenger_car",
      stage: "growth",
      stageStartedTurn: 11,
      startedTurn: 10,
      allocations: [{ sectorId: sectorId.toString(), share: 1 }],
      developmentPaidAnchor: 100,
      paidThresholdAnchor: 100,
      elapsedDevelopmentTurns: 12,
      elapsedThresholdTurns: 12,
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/1/products"), {
      params: Promise.resolve({ id: "1" }),
    });
    const body = await response.json();

    expect(body.productResults).toEqual([
      {
        sectorId: sectorId.toString(),
        turn: 12,
        producedUnits: 20,
        soldUnits: 10,
        quality: 72,
      },
    ]);
    expect(body.catalog.find((kind: { id: string }) => kind.id === "passenger_car")).toHaveProperty(
      "technologyRequirements"
    );
    expect(
      db.collectionMocks.corporateSectors.find.mock.results[0].value.project
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        productLineProjectId: 1,
        productLineOutputTurn: 1,
        productLineOutputUnitsByCommodity: 1,
        productLineSoldUnitsByCommodity: 1,
        productLineQualityByCommodity: 1,
      })
    );
  });

  it("returns the monetary basis for a partial-allocation preview without rewriting an existing quote", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      marketSystemMode: "plants",
      productLinesV2Enabled: true,
    });
    db.collectionMocks.manufacturingProductProjectsV2.findOne.mockResolvedValue({
      _id: "existing",
      kindId: "passenger_car",
      stage: "development",
      startedTurn: 10,
      allocations: [{ sectorId: sectorId.toString(), share: 0.5 }],
      paidThresholdAnchor: 25,
      developmentPaidAnchor: 12,
      elapsedDevelopmentTurns: 4,
      elapsedThresholdTurns: 12,
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/1/products"), {
      params: Promise.resolve({ id: "1" }),
    });
    const body = await response.json();
    expect(body.plants[0]).toMatchObject({ capitalStock: 1000, developmentCapitalAnchor: 50_000 });
    expect(body.allocatedCapacityStock).toBe(500);
    expect(body.activeProject).toMatchObject({
      paidThresholdAnchor: 25,
      developmentPaidAnchor: 12,
    });
  });

  it("does not attribute another project's snapshot to a new development stage", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
      productLinesV2Enabled: true,
    });
    sectors = [
      {
        ...sectors[0],
        productLineProjectId: "old-project",
        productLineOutputTurn: 12,
        productLineOutputUnitsByCommodity: { vehicles: 100 },
        productLineSoldUnitsByCommodity: { vehicles: 100 },
        productLineQualityByCommodity: { vehicles: 70 },
      },
    ];
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor(sectors));
    db.collectionMocks.manufacturingProductProjectsV2.findOne.mockResolvedValue({
      _id: "new-project",
      corporationId: corporationId.toString(),
      activeCorporationId: corporationId.toString(),
      kindId: "passenger_car",
      stage: "development",
      stageStartedTurn: 10,
      startedTurn: 10,
      allocations: [{ sectorId: sectorId.toString(), share: 1 }],
      developmentPaidAnchor: 0,
      paidThresholdAnchor: 100,
      elapsedDevelopmentTurns: 0,
      elapsedThresholdTurns: 12,
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/1/products"), {
      params: Promise.resolve({ id: "1" }),
    });

    expect((await response.json()).productResults).toEqual([]);
  });

  it("reports zero product sales during development even when recipe output exists", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
      productLinesV2Enabled: true,
    });
    sectors = [
      {
        ...sectors[0],
        outputUnitsByCommodity: { vehicles: 80, steel: 20 },
        soldByCommodity: { vehicles: 0.75 },
        productLineProjectId: "project-1",
        productLineOutputTurn: 11,
        productLineOutputUnitsByCommodity: { vehicles: 0 },
        productLineSoldUnitsByCommodity: { vehicles: 0 },
        productLineQualityByCommodity: { vehicles: 70 },
      },
    ];
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor(sectors));
    db.collectionMocks.manufacturingProductProjectsV2.findOne.mockResolvedValue({
      _id: "project-1",
      corporationId: corporationId.toString(),
      activeCorporationId: corporationId.toString(),
      kindId: "passenger_car",
      stage: "development",
      stageStartedTurn: 10,
      startedTurn: 10,
      allocations: [{ sectorId: sectorId.toString(), share: 1 }],
      developmentPaidAnchor: 0,
      paidThresholdAnchor: 100,
      elapsedDevelopmentTurns: 1,
      elapsedThresholdTurns: 12,
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/corporations/1/products"), {
      params: Promise.resolve({ id: "1" }),
    });

    expect((await response.json()).productResults).toEqual([
      {
        sectorId: sectorId.toString(),
        turn: 11,
        producedUnits: 0,
        soldUnits: 0,
        quality: 70,
      },
    ]);
  });

  it("no longer starts projects here and points to the studio", async () => {
    const { POST } = await import("./route");
    const response = await POST();
    expect(response.status).toBe(410);
    expect(db.collectionMocks.manufacturingProductProjectsV2.insertOne).not.toHaveBeenCalled();
  });

  it("retires the active slot so another project may be started", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
      productLinesV2Enabled: true,
    });
    db.collectionMocks.manufacturingProductProjectsV2.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    } as never);
    const { POST } = await import("./[projectId]/retire/route");
    const response = await POST(
      new Request("http://localhost/api/corporations/1/products/project-1/retire"),
      {
        params: Promise.resolve({ id: "1", projectId: "project-1" }),
      }
    );
    expect(response.status).toBe(200);
    expect(db.collectionMocks.manufacturingProductProjectsV2.updateOne).toHaveBeenCalledWith(
      {
        _id: "project-1",
        corporationId: corporationId.toString(),
        activeCorporationId: corporationId.toString(),
      },
      { $set: { stage: "retired" }, $unset: { activeCorporationId: "" } }
    );
  });
});
