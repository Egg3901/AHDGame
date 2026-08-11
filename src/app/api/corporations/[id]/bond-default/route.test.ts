import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  // Pre-initialize collections
  db.collection("bonds");
  db.collection("corporateSectors");
  db.collection("centralBanks");
  db.collection("corporationHistory");
  db.collection("characters");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
}

function makeBasicAuth(userId: string) {
  return { ok: true, user: { userId } };
}

describe("GET /api/corporations/[id]/bond-default", () => {
  it("returns 401 when not authenticated", async () => {
    await setup();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not CEO", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, ceoId: new ObjectId() },
    } as any);

    const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(requireCeo).mockReturnValue(
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }) as any
    );

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(403);
  });

  it("returns 400 for national corporations", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, ceoId: new ObjectId(userId), countryOwnerId: new ObjectId() },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("National corporations");
  });

  it("returns active: false when no bonds are defaulted", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, ceoId: new ObjectId(userId) },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        { _id: new ObjectId(), corporationId: corpId, matured: false, defaulted: false },
      ],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.active).toBe(false);
  });

  it("returns full crisis panel when bonds are defaulted", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        ceoId: new ObjectId(userId),
        liquidCapital: 500000,
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
      },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as any);

    // Defaulted bonds
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          matured: false,
          defaulted: true,
          totalIssued: 100000,
          holders: [{ characterId: charId, units: 100 }],
        },
      ],
    });

    // Corporate sectors
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          countryId: "US",
          stateId: "US_CA",
          revenue: 10000,
          profitMargin: 35,
          targetGrowthRate: 5,
          currentGrowthRate: 5,
        },
      ],
    });

    // Central banks
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: async () => [{ countryId: "US", primeRate: 5.5 }],
    });

    // Corporation history
    db.collectionMocks.corporationHistory.findOne.mockResolvedValue({
      turn: 90,
      income: 5000,
    });

    // Shareholder character
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: async () => [{ _id: charId, name: "Test Investor" }],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.active).toBe(true);
    expect(data.currentTurn).toBe(100);
    expect(data.liquidCapital).toBe(500000);
    expect(data.defaultedPrincipal).toBe(100000);
    expect(data.totalEquity).toBeDefined();
    expect(data.cash).toBeDefined();
    expect(data.cash.canPay).toBe(true); // 500k >= 100k
    expect(data.cash.cost).toBe(100000);
    expect(data.refinance).toBeDefined();
    expect(data.refinance.canRefinance).toBeDefined();
    expect(data.refinance.imfRestructuring).toBe(false);
    expect(data.refinance.primeRate).toBe(5.5);
    expect(data.dissolve).toBeDefined();
    expect(data.dissolve.preview).toBeDefined();
    expect(data.dissolve.shareholders).toBeDefined();
    expect(data.creditPenalty).toBeDefined();
    expect(data.creditPenalty.active).toBeDefined();
  });

  it("nets escrow into the dissolve preview and lets a positive escrow cover a cash-pay shortfall", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    const { getGameState } = await import("@/lib/gameState");

    // Shared mocks for both runs (only the corp's escrow differs). defaultedPrincipal
    // (cashCost) resolves to 100000; liquidCapital is set BELOW it to force a shortfall.
    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          matured: false,
          defaulted: true,
          totalIssued: 100000,
          holders: [{ characterId: charId, units: 100 }],
        },
      ],
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: async () => [{ countryId: "US", primeRate: 5.5 }],
    });
    db.collectionMocks.corporationHistory.findOne.mockResolvedValue({ turn: 90, income: 5000 });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: async () => [{ _id: charId, name: "Test Investor" }],
    });

    async function runWithEscrow(shareEscrowBalance: number) {
      vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);
      vi.mocked(requireCeo).mockReturnValue(null);
      vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as any);
      vi.mocked(resolveCorporation).mockResolvedValue({
        ok: true,
        corporation: {
          _id: corpId,
          ceoId: new ObjectId(userId),
          liquidCapital: 50000, // below the 100000 cashCost → shortfall
          shareEscrowBalance,
          countryId: "US",
          headquartersState: "US_CA",
          shareholders: [{ characterId: charId, shares: 100 }],
        },
      } as any);
      const { GET } = await import("./route");
      const res = await GET(new Request("http://localhost/api/corporations/abc/bond-default"), {
        params: Promise.resolve({ id: "abc" }),
      });
      return res.json();
    }

    const withoutEscrow = await runWithEscrow(0);
    const withReserve = await runWithEscrow(200000);

    // Dissolve pool nets the positive escrow (more for the waterfall).
    expect(withReserve.dissolve.preview.totalAssets).toBeGreaterThan(
      withoutEscrow.dissolve.preview.totalAssets
    );
    expect(withReserve.dissolve.preview.shareholderPool).toBeGreaterThan(
      withoutEscrow.dissolve.preview.shareholderPool
    );
    // Bonds-only escrow fallback: liquidCapital (50k) alone can't cover the 100k
    // cash-pay, but liquidCapital + positive escrow (250k) can.
    expect(withoutEscrow.cash.canPay).toBe(false);
    expect(withReserve.cash.canPay).toBe(true);
    // The displayed liquidCapital figure stays escrow-exclusive (escrow is a separate reserve).
    expect(withReserve.liquidCapital).toBe(withoutEscrow.liquidCapital);
    expect(withReserve.cash.cost).toBe(withoutEscrow.cash.cost);
  });

  it("sets refinance.imfRestructuring and blocks refinance when IMF bailout is active", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        ceoId: new ObjectId(userId),
        liquidCapital: 500000,
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        imfBailoutActive: true,
      },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as any);

    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          matured: false,
          defaulted: true,
          totalIssued: 100000,
          holders: [{ characterId: charId, units: 100 }],
        },
      ],
    });

    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          countryId: "US",
          stateId: "US_CA",
          revenue: 10000,
          profitMargin: 35,
          targetGrowthRate: 5,
          currentGrowthRate: 5,
        },
      ],
    });

    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: async () => [{ countryId: "US", primeRate: 5.5 }],
    });

    db.collectionMocks.corporationHistory.findOne.mockResolvedValue({
      turn: 90,
      income: 5000,
    });

    db.collectionMocks.characters.find.mockReturnValue({
      toArray: async () => [{ _id: charId, name: "Test Investor" }],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.active).toBe(true);
    expect(data.refinance.imfRestructuring).toBe(true);
    expect(data.refinance.canRefinance).toBe(false);
  });

  it("shows cash cannot pay when liquidCapital is insufficient", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        ceoId: new ObjectId(userId),
        liquidCapital: 50000, // Less than defaulted principal
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [],
      },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as any);

    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          matured: false,
          defaulted: true,
          totalIssued: 100000,
          holders: [],
        },
      ],
    });

    db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.centralBanks.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporationHistory.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.cash.canPay).toBe(false); // 50k < 100k
    expect(data.cash.cost).toBe(100000);
  });

  it("includes shareholder names in dissolve preview", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId1 = new ObjectId();
    const charId2 = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        ceoId: new ObjectId(userId),
        liquidCapital: 1000000,
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [
          { characterId: charId1, shares: 100 },
          { characterId: charId2, shares: 50 },
        ],
      },
    } as any);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as any);

    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          matured: false,
          defaulted: true,
          totalIssued: 50000,
          holders: [{ characterId: charId1, units: 100 }],
        },
      ],
    });

    db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.centralBanks.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporationHistory.findOne.mockResolvedValue({ turn: 90, income: 5000 });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: async () => [
        { _id: charId1, name: "Alice Investor" },
        { _id: charId2, name: "Bob Shareholder" },
      ],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/bond-default");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.dissolve).toBeDefined();
    expect(data.dissolve.preview).toBeDefined();
    expect(data.dissolve.shareholders).toBeDefined();
  });
});
