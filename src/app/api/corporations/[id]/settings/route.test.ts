import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true as const })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));
vi.mock("@/lib/api/corporations/resolveQuery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/corporations/resolveQuery")>();
  return {
    ...actual,
    resolveCorporation: vi.fn(),
  };
});
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency/corporationCapital")>();
  return {
    ...actual,
    loadFxRatesByCurrency: vi.fn().mockResolvedValue(
      new Map([
        ["USD", 1],
        ["GBP", 2],
        ["JPY", 100],
      ])
    ),
  };
});

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("corporationHistory");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
});

function makeBasicAuth(userId: string) {
  return { ok: true as const, user: { userId } };
}

async function postBudgetSettings(
  corporationOverrides: Record<string, unknown>,
  sectors: Record<string, unknown>[],
  payload: Record<string, unknown>,
  historyRevenue?: number
) {
  const userId = new ObjectId().toString();
  const corporation = {
    _id: new ObjectId(),
    userId: new ObjectId(userId),
    type: "retail",
    headquartersState: "CA",
    countryId: "US",
    ...corporationOverrides,
  };
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation } as never);
  db.collectionMocks["corporateSectors"]!.find.mockReturnValue({
    toArray: async () => sectors,
  } as never);
  if (historyRevenue !== undefined) {
    db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({
      revenue: historyRevenue,
    });
  }

  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/corporations/1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: "1" }) }
  );
}

describe("POST /api/corporations/[id]/settings", () => {
  it("returns 401 when not authenticated", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "x" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when marketingBudget is negative", async () => {
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        userId: new ObjectId(userId),
        type: "retail",
        headquartersState: "CA",
        countryId: "US",
      },
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketingBudget: -5 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("caps a new budget against realized sales rather than nameplate revenue", async () => {
    const res = await postBudgetSettings(
      { liquidCurrencyCode: "USD" },
      [
        {
          countryId: "US",
          revenue: 10_000,
          realizedRevenue: 100,
          productionPolicyLevel: 0,
        },
      ],
      { marketingBudget: 151 }
    );
    expect(res.status).toBe(400);
  });

  it("uses the nameplate fallback for a newly founded corporation with no history", async () => {
    const res = await postBudgetSettings(
      { liquidCurrencyCode: "USD" },
      [{ countryId: "US", revenue: 1_000, productionPolicyLevel: 0 }],
      { marketingBudget: 1_501 }
    );
    expect(res.status).toBe(400);
  });

  it("uses corporation history to realize legacy sector revenue", async () => {
    const res = await postBudgetSettings(
      { liquidCurrencyCode: "USD" },
      [{ countryId: "US", revenue: 1_000, productionPolicyLevel: 0 }],
      { marketingBudget: 151 },
      100 / TURNS_PER_DAY
    );
    expect(res.status).toBe(400);
  });

  it("rejects positive overhead when realized daily revenue is zero", async () => {
    const res = await postBudgetSettings(
      { liquidCurrencyCode: "USD" },
      [{ countryId: "US", revenue: 1_000, realizedRevenue: 0, productionPolicyLevel: 0 }],
      { marketingBudget: 1 }
    );
    expect(res.status).toBe(400);
  });

  it("includes freight credits and converts realized revenue from host to corp currency", async () => {
    const res = await postBudgetSettings(
      { countryId: "GB", liquidCurrencyCode: "GBP" },
      [
        {
          countryId: "JP",
          revenue: 1_000,
          realizedRevenue: 300,
          freightBillingCredit: 50,
          productionPolicyLevel: 0,
        },
      ],
      { marketingBudget: 10.6 }
    );
    // ¥300 realized sales + ¥50 freight credit = ¥350, restated at JPY 100 / ₳
    // and GBP 2 / ₳ to £7 daily; 150% permits £10.50.
    expect(res.status).toBe(400);
  });

  it("allows reducing an existing over-cap budget when realized revenue is zero", async () => {
    const res = await postBudgetSettings(
      { liquidCurrencyCode: "USD", marketingBudget: 300, logisticsBudget: 300 },
      [
        {
          countryId: "US",
          revenue: 1_000,
          realizedRevenue: 0,
          productionPolicyLevel: 0,
        },
      ],
      { marketingBudget: 200 }
    );
    expect(res.status).toBe(200);
    expect(db.collectionMocks["corporations"]!.updateOne).toHaveBeenCalled();
  });

  it("returns 200 and updates when CEO sends valid payload", async () => {
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        userId: new ObjectId(userId),
        type: "retail",
        headquartersState: "CA",
        countryId: "US",
        marketingBudget: 1000,
      },
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/1/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "New tagline" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(db.collectionMocks["corporations"]!.updateOne).toHaveBeenCalled();
  });
});
