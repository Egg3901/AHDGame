import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("economicVitalSigns");
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

describe("GET /api/admin/economy/vital-signs", () => {
  it("rejects a non-admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/admin/economy/vital-signs"));
    expect(response.status).toBe(403);
  });

  it("returns a requested turn without exposing source rows", async () => {
    await setupAdmin();
    const snapshot = { _id: "turn:100", schemaVersion: 1, turn: 100 };
    db.collectionMocks.economicVitalSigns.findOne.mockResolvedValue(snapshot);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/vital-signs?turn=100")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot });
    expect(db.collectionMocks.economicVitalSigns.findOne).toHaveBeenCalledWith({ turn: 100 });
  });

  it("rejects an invalid turn", async () => {
    await setupAdmin();
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/admin/economy/vital-signs?turn=-1")
    );
    expect(response.status).toBe(400);
  });
});
