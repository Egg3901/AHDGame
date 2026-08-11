import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

describe("/api/admin/conflicts/cold-war/toggle", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  async function mockAdmin() {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
  }

  it("GET still reports the stored flag state", async () => {
    await mockAdmin();
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      coldWarEnabled: true,
      coldWarEnabledBy: "someone",
    });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.enabled).toBe(true);
    expect(data.enabledBy).toBe("someone");
  });

  it("POST rejects non-admins", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { POST } = await import("./route");
    const res = await POST();

    expect(res.status).toBe(403);
  });

  it("POST refuses to write the retired flag (409) and never touches the DB", async () => {
    await mockAdmin();

    const { POST } = await import("./route");
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/retired/i);
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });
});
