import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("nppMarketEntryFunnels");
  vi.clearAllMocks();
});

async function setupAdmin() {
  const { getDb } = await import("@/lib/mongodb");
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: "admin", isAdmin: true },
  } as never);
}

describe("GET /api/admin/economy/npp-entry-funnel", () => {
  it("rejects a non-admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/npp-entry-funnel"));
    expect(response.status).toBe(403);
  });

  it("returns the current funnel without recomputing it", async () => {
    await setupAdmin();
    const doc = {
      _id: "current",
      schemaVersion: 1,
      turn: 440,
      generatedAt: new Date("2026-08-28T00:00:00Z"),
      corporationsObserved: 2,
      entered: 1,
      rejected: 1,
      reasonCounts: { entered: 1, cash_floor: 1 },
      diagnostics: [
        { corporationId: "a", countryId: "US", reason: "entered" },
        { corporationId: "b", countryId: "US", reason: "cash_floor" },
      ],
    };
    db.collectionMocks.nppMarketEntryFunnels.findOne.mockResolvedValue(doc);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/npp-entry-funnel"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      funnel: { ...doc, generatedAt: doc.generatedAt.toISOString() },
    });
    expect(db.collectionMocks.nppMarketEntryFunnels.findOne).toHaveBeenCalledWith({
      _id: "current",
    });
  });

  it("returns a retained turn snapshot on request", async () => {
    await setupAdmin();
    const doc = {
      _id: "turn:439",
      schemaVersion: 1,
      turn: 439,
      generatedAt: new Date("2026-08-28T00:00:00Z"),
      corporationsObserved: 1,
      entered: 0,
      rejected: 1,
      reasonCounts: { founding_cost: 1 },
      diagnostics: [{ corporationId: "a", countryId: "US", reason: "founding_cost" }],
    };
    db.collectionMocks.nppMarketEntryFunnels.findOne.mockResolvedValue(doc);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/npp-entry-funnel?turn=439")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      funnel: { ...doc, generatedAt: doc.generatedAt.toISOString() },
    });
    expect(db.collectionMocks.nppMarketEntryFunnels.findOne).toHaveBeenCalledWith({
      _id: "turn:439",
    });
  });

  it("serves a pre-evidence document with derived aggregates", async () => {
    await setupAdmin();
    db.collectionMocks.nppMarketEntryFunnels.findOne.mockResolvedValue({
      _id: "current",
      turn: 438,
      diagnostics: [{ corporationId: "a", countryId: "US", reason: "cash_floor" }],
    });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/npp-entry-funnel"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      funnel: { corporationsObserved: number; entered: number; rejected: number };
    };
    expect(body.funnel).toMatchObject({ corporationsObserved: 1, entered: 0, rejected: 1 });
  });

  it("returns 404 when no funnel snapshot exists", async () => {
    await setupAdmin();
    db.collectionMocks.nppMarketEntryFunnels.findOne.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/npp-entry-funnel"));
    expect(response.status).toBe(404);
  });

  it("rejects an invalid turn", async () => {
    await setupAdmin();
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/npp-entry-funnel?turn=-1")
    );
    expect(response.status).toBe(400);
  });
});
