import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, getGameStateMock, getCurrentTurnMock, requireBasicAuthMock, resolveMock } =
  vi.hoisted(() => ({
    getDbMock: vi.fn(),
    getGameStateMock: vi.fn(),
    getCurrentTurnMock: vi.fn(),
    requireBasicAuthMock: vi.fn(),
    resolveMock: vi.fn(),
  }));

vi.mock("@/lib/mongodb", () => ({ getDb: getDbMock }));
vi.mock("@/lib/gameState", () => ({ getGameState: getGameStateMock }));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: getCurrentTurnMock }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: requireBasicAuthMock }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: resolveMock,
  requireCeo: vi.fn(() => null),
}));

function request(body?: unknown) {
  return new Request("http://localhost/api/corporations/1/media-products", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("/api/corporations/[id]/media-products", () => {
  const corporationId = new ObjectId("507f1f77bcf86cd799439011");
  const sectorId = new ObjectId("507f1f77bcf86cd799439012");
  const corporation = {
    _id: corporationId,
    userId: "user-1",
    liquidCapital: 100_000,
    type: "media",
  };
  let collections: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
  let projectFind: ReturnType<typeof vi.fn>;
  let insertOne: ReturnType<typeof vi.fn>;
  let sectorFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    projectFind = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    insertOne = vi.fn().mockResolvedValue({ acknowledged: true });
    const sectorCursor = {
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    sectorFind = vi.fn().mockReturnValue(sectorCursor);
    collections = {
      gameConfig: {
        findOne: vi.fn().mockResolvedValue({
          marketSystemMode: "clearing",
          mediaOperatingModelsEnabled: true,
          mediaProductSlatesEnabled: true,
          brandLoyaltyEnabled: true,
          brandLoyaltySliceEnabled: true,
          qualityPremiumPricingEnabled: true,
        }),
      },
      mediaProductProjectsV1: { find: projectFind, insertOne },
      corporateSectors: { find: sectorFind, findOne: vi.fn() },
    };
    getDbMock.mockResolvedValue({
      collection: vi.fn((name: string) => collections[name]),
    });
    getGameStateMock.mockResolvedValue({ currentYear: 1991 });
    getCurrentTurnMock.mockResolvedValue(100);
    requireBasicAuthMock.mockResolvedValue({ ok: true, user: { userId: "user-1" } });
    resolveMock.mockResolvedValue({ ok: true, corporation });
  });

  it("returns before reading product documents while the feature is off", async () => {
    collections.gameConfig = {
      findOne: vi.fn().mockResolvedValue({ marketSystemMode: "clearing" }),
    };
    const { GET } = await import("./route");
    const response = await GET(request(), { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false });
    expect(projectFind).not.toHaveBeenCalled();
    expect(sectorFind).not.toHaveBeenCalled();
  });

  it("starts an owned title only on its already unlocked operating model", async () => {
    collections.corporateSectors = {
      find: sectorFind,
      findOne: vi.fn().mockResolvedValue({
        _id: sectorId,
        corporationId,
        sectorType: "media",
        mediaDiscriminator: null,
        strategyId: "newspaper",
        capitalStock: 500,
        capacityBookAnchor: 500,
      }),
    };
    const { POST } = await import("./route");
    const response = await POST(
      request({
        kindId: "newspaper_edition",
        sectorId: sectorId.toString(),
        title: "The Evening Record",
        allocationShare: 0.4,
      }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(201);
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        corporationId: corporationId.toString(),
        sectorId: sectorId.toString(),
        kindId: "newspaper_edition",
        allocationShare: 0.4,
        paidThresholdAnchor: 25,
        activeDevelopmentCorporationId: corporationId.toString(),
      })
    );
    expect(projectFind).not.toHaveBeenCalled();
  });

  it("rejects development without a monetary capacity basis", async () => {
    collections.corporateSectors = {
      find: sectorFind,
      findOne: vi.fn().mockResolvedValue({
        _id: sectorId,
        corporationId,
        sectorType: "media",
        mediaDiscriminator: null,
        strategyId: "newspaper",
        capitalStock: 0,
        capacityBookAnchor: 0,
      }),
    };
    const { POST } = await import("./route");
    const response = await POST(
      request({
        kindId: "newspaper_edition",
        sectorId: sectorId.toString(),
        title: "The Evening Record",
        allocationShare: 0.4,
      }),
      { params: Promise.resolve({ id: "1" }) }
    );

    expect(response.status).toBe(409);
    expect(insertOne).not.toHaveBeenCalled();
  });
});
