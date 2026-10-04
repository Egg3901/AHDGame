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
  db = createMockDb();
  for (const collection of ["gameConfig", "corporateSectors", "manufacturingProductProjectsV2", "gameState"])
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
  db.collectionMocks.manufacturingProductProjectsV2.insertOne.mockResolvedValue({ acknowledged: true } as never);
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
  });

  it("creates one legal plant-backed project with paid and elapsed development thresholds", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
      productLinesV2Enabled: true,
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/1/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kindId: "passenger_car",
          allocations: [{ sectorId: sectorId.toString(), share: 0.5 }],
        }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(response.status).toBe(201);
    const project = db.collectionMocks.manufacturingProductProjectsV2.insertOne.mock.calls[0][0];
    expect(project).toMatchObject({
      corporationId: corporationId.toString(),
      activeCorporationId: corporationId.toString(),
      kindId: "passenger_car",
      stage: "development",
      paidThresholdAnchor: 25,
      elapsedThresholdTurns: 12,
    });
    expect(project.allocations).toEqual([{ sectorId: sectorId.toString(), share: 0.5 }]);
  });

  it("rejects an allocation to a plant without physical capacity", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
      productLinesV2Enabled: true,
    });
    sectors = [{ ...sectors[0], capitalStock: 0, plantCount: 0 }];
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor(sectors));
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/1/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kindId: "passenger_car",
          allocations: [{ sectorId: sectorId.toString(), share: 0.5 }],
        }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(response.status).toBe(400);
    expect(db.collectionMocks.manufacturingProductProjectsV2.insertOne).not.toHaveBeenCalled();
  });

  it("enforces the one-active-project corporation slot", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
      productLinesV2Enabled: true,
    });
    db.collectionMocks.manufacturingProductProjectsV2.findOne.mockResolvedValue({ _id: "already-active" });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/1/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kindId: "passenger_car",
          allocations: [{ sectorId: sectorId.toString(), share: 0.5 }],
        }),
      }),
      { params: Promise.resolve({ id: "1" }) }
    );
    expect(response.status).toBe(409);
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
    const response = await POST(new Request("http://localhost/api/corporations/1/products/project-1/retire"), {
      params: Promise.resolve({ id: "1", projectId: "project-1" }),
    });
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
