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
      corporation: {
        ...detailPayload.corporation,
        viewerIsControllingParentCeo: false,
        openPrivatizationVoteId: null,
      },
      isPrivate: false,
      financialFogOfWar: null,
      // Procurement position. Present on every corporation, empty for one the state has
      // never contracted — a missing block would read to the page as "still loading".
      defenceContracts: {
        contracts: [],
        pendingCount: 0,
        gradeCeiling: 0,
        totalEarned: 0,
        // Gross earnings alone became misleading once deliveries carried a production cost:
        // a corporation can take a fat headline number on a contract it lost money on.
        totalNetMargin: 0,
        totalEncumbered: 0,
      },
    });
  });

  it("exposes a private subsidiary's books only to its controlling parent CEO", async () => {
    await wireDb();
    const subsidiary = makeCorporation({
      _id: new ObjectId(),
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      isPrivate: true,
      liquidCapital: 125_000,
    });
    const parent = makeCorporation({ _id: new ObjectId(), userId: new ObjectId() });
    const detailPayload = {
      corporation: {
        _id: subsidiary._id.toString(),
        name: subsidiary.name,
        liquidCapital: 125_000,
        parentCorporation: { _id: parent._id.toString(), ownershipPct: 100 },
      },
      ceo: null,
      financials: { totalRevenue: 80_000 },
      sectors: [],
      balanceSheet: { assets: { cashOnHand: 125_000 }, liabilities: {}, equity: {} },
    };
    db.collectionMocks["corporations"]!.findOne.mockResolvedValueOnce(
      subsidiary
    ).mockResolvedValueOnce(parent);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: parent.userId.toString() } as never);
    const { loadCorporationDetailView } =
      await import("@/lib/corporations/queries/corporationDetail");
    vi.mocked(loadCorporationDetailView).mockResolvedValue(detailPayload as never);

    const { GET } = await import("./route");
    const parentRes = await GET(
      new Request(`http://localhost/api/corporations/${subsidiary._id}`),
      { params: Promise.resolve({ id: subsidiary._id.toString() }) }
    );
    const parentJson = await parentRes.json();

    expect(parentRes.status).toBe(200);
    expect(parentJson.corporation.viewerIsControllingParentCeo).toBe(true);
    expect(parentJson.corporation.liquidCapital).toBe(125_000);
    expect(parentJson.financials).toEqual(detailPayload.financials);
    expect(parentJson.balanceSheet).toEqual(detailPayload.balanceSheet);

    const outsiderUserId = new ObjectId().toString();
    db.collectionMocks["corporations"]!.findOne.mockResolvedValueOnce(
      subsidiary
    ).mockResolvedValueOnce(parent);
    vi.mocked(getAuthUser).mockResolvedValue({ userId: outsiderUserId } as never);
    const outsiderRes = await GET(
      new Request(`http://localhost/api/corporations/${subsidiary._id}`),
      { params: Promise.resolve({ id: subsidiary._id.toString() }) }
    );
    const outsiderJson = await outsiderRes.json();

    expect(outsiderRes.status).toBe(200);
    expect(outsiderJson.corporation.viewerIsControllingParentCeo).toBe(false);
    expect(outsiderJson.corporation.liquidCapital).toBeUndefined();
    expect(outsiderJson.financials).toBeNull();
    expect(outsiderJson.balanceSheet).toBeNull();
  });

  it("marks the controlling parent CEO as an insider of a public subsidiary", async () => {
    await wireDb();
    const subsidiary = makeCorporation({
      _id: new ObjectId(),
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      isPrivate: false,
    });
    const parent = makeCorporation({ _id: new ObjectId(), userId: new ObjectId() });
    const detailPayload = {
      corporation: {
        _id: subsidiary._id.toString(),
        name: subsidiary.name,
        parentCorporation: { _id: parent._id.toString(), ownershipPct: 100 },
      },
      ceo: null,
      financials: { totalRevenue: 80_000 },
      sectors: [],
      balanceSheet: { assets: { cashOnHand: 100 }, liabilities: {}, equity: {} },
    };
    db.collectionMocks["corporations"]!.findOne.mockResolvedValueOnce(
      subsidiary
    ).mockResolvedValueOnce(parent);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: parent.userId.toString() } as never);
    const { loadCorporationDetailView } =
      await import("@/lib/corporations/queries/corporationDetail");
    vi.mocked(loadCorporationDetailView).mockResolvedValue(detailPayload as never);

    const { GET } = await import("./route");
    const res = await GET(new Request(`http://localhost/api/corporations/${subsidiary._id}`), {
      params: Promise.resolve({ id: subsidiary._id.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.corporation.viewerIsControllingParentCeo).toBe(true);
    expect(json.financialFogOfWar).toBeNull();
    expect(json.financials).toEqual(detailPayload.financials);
  });
});
