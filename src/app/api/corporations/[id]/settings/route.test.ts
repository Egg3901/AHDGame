import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
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

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporations");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);
});

function makeBasicAuth(userId: string) {
  return { ok: true as const, user: { userId } };
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
