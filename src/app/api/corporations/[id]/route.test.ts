import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { makeCorporation } from "@/lib/test-utils/factories";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 10 }),
}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/corporations/queries/corporationDetail", () => ({
  loadCorporationDetailView: vi.fn(),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporations");
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 10 } as never);
});

async function wireDb() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 10 } as never);
}

describe("GET /api/corporations/[id]", () => {
  it("returns 400 for invalid corporation id param", async () => {
    await wireDb();
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/not-valid-id"), {
      params: Promise.resolve({ id: "not-valid-id" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid");
  });

  it("returns 404 when corporation does not exist", async () => {
    await wireDb();
    const hex = new ObjectId().toString();
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(new Request(`http://localhost/api/corporations/${hex}`), {
      params: Promise.resolve({ id: hex }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("not found");
  });

  it("delegates successful detail reads to the corporation detail query", async () => {
    await wireDb();
    const corporation = makeCorporation({
      _id: new ObjectId(),
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation);

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: corporation.userId.toString() } as never);

    const detailPayload = {
      corporation: { _id: corporation._id.toString(), name: corporation.name },
      ceo: null,
      financials: { totalRevenue: 0 },
      sectors: [],
      balanceSheet: { assets: {}, liabilities: {}, equity: {} },
    };
    const { loadCorporationDetailView } =
      await import("@/lib/corporations/queries/corporationDetail");
    vi.mocked(loadCorporationDetailView).mockResolvedValue(detailPayload as never);

    const { GET } = await import("./route");
    const res = await GET(new Request(`http://localhost/api/corporations/${corporation._id}`), {
      params: Promise.resolve({ id: corporation._id.toString() }),
    });

    expect(res.status).toBe(200);
    expect(loadCorporationDetailView).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        corporation,
        currentTurn: 10,
        viewerUserId: expect.any(String),
      })
    );
    // Response wraps the detail payload with isPrivate and financialFogOfWar metadata.
    // openPrivatizationVoteId is nested under corporation because the page stores
    // data.corporation directly.
    await expect(res.json()).resolves.toEqual({
      ...detailPayload,
      corporation: { ...detailPayload.corporation, openPrivatizationVoteId: null },
      isPrivate: false,
      financialFogOfWar: null,
      // Procurement position. Present on every corporation, empty for one the state has
      // never contracted — a missing block would read to the page as "still loading".
      defenceContracts: { contracts: [], pendingCount: 0, gradeCeiling: 0, totalEarned: 0 },
    });
  });
});
