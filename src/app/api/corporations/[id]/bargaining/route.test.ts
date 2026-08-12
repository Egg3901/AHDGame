import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/labour/featureFlag", () => ({ isLabourFullMode: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

let db: MockDb;
const corporationId = new ObjectId();
const corporationRouteId = corporationId.toString();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("bargainingCampaigns");
  db.collection("collectiveAgreements");
  db.collection("unions");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user-1" },
  } as never);
  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: corporationId },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
  const { isLabourFullMode } = await import("@/lib/labour/featureFlag");
  vi.mocked(isLabourFullMode).mockResolvedValue(true);
  const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
  vi.mocked(getCurrentTurn).mockResolvedValue(420);
});

describe("GET /api/corporations/[id]/bargaining", () => {
  it("returns the authentication response before corporation lookup", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/corporations/${corporationRouteId}/bargaining`),
      { params: Promise.resolve({ id: corporationRouteId }) }
    );

    expect(response.status).toBe(401);
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    expect(resolveCorporation).not.toHaveBeenCalled();
  });

  it("returns the CEO authorization response before reading bargaining records", async () => {
    const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(requireCeo).mockReturnValue(
      Response.json({ error: "Only the CEO can view bargaining." }, { status: 403 }) as never
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/corporations/${corporationRouteId}/bargaining`),
      { params: Promise.resolve({ id: corporationRouteId }) }
    );

    expect(response.status).toBe(403);
    expect(db.collectionMocks.bargainingCampaigns.find).not.toHaveBeenCalled();
  });

  it("returns the CEO's campaigns and only currently effective agreements", async () => {
    const unionId = new ObjectId();
    const campaignId = new ObjectId();
    const currentOffer = {
      revision: 2,
      proposedBy: "union",
      wageLevel: 1.1,
      agreementDurationTurns: 48,
      noStrikeTurns: 24,
      proposedAtTurn: 418,
      proposedAt: new Date("2026-08-09T00:00:00Z"),
    };
    db.collectionMocks.bargainingCampaigns.find().toArray.mockResolvedValue([
      {
        _id: campaignId,
        unionId,
        employerCorporationId: corporationId,
        status: "dispute",
        escalationLevel: "overtime_ban",
        sectorIds: [new ObjectId(), new ObjectId()],
        mandate: { support: 55, leverage: 49 },
        currentOffer,
        offers: [currentOffer],
        startedAtTurn: 410,
        deadlineTurn: 418,
        lastActionTurn: 418,
        disputeStartedAtTurn: 418,
      },
    ]);
    db.collectionMocks.collectiveAgreements.find().toArray.mockResolvedValue([
      {
        _id: new ObjectId(),
        unionId,
        // The route's own query filters `status: "active"`, so no row it ever
        // receives can be missing this. The fixture omitted it, which only
        // passed while the in-memory check looked at the turn bounds alone.
        status: "active",
        startsAtTurn: 419,
        expiresAtTurn: 430,
        noStrikeUntilTurn: 425,
        wageLevel: 1.08,
        sectorIds: [new ObjectId()],
      },
      {
        _id: new ObjectId(),
        unionId,
        status: "active",
        startsAtTurn: 400,
        expiresAtTurn: 420,
        noStrikeUntilTurn: 410,
        wageLevel: 1.02,
        sectorIds: [new ObjectId()],
      },
    ]);
    db.collectionMocks.unions.find().toArray.mockResolvedValue([{ _id: unionId, name: "Workers" }]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/corporations/${corporationRouteId}/bargaining`),
      { params: Promise.resolve({ id: corporationRouteId }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.campaigns).toEqual([
      expect.objectContaining({
        campaignId: campaignId.toString(),
        unionName: "Workers",
        sectorCount: 2,
        mediationAvailableTurn: 420,
      }),
    ]);
    expect(data.agreements).toEqual([
      expect.objectContaining({ unionName: "Workers", expiresAtTurn: 430 }),
    ]);
  });
});
