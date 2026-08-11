import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function makePost(enabled: boolean): Request {
  return new Request("http://localhost/api/admin/conflicts/general/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

describe("/api/admin/conflicts/general/toggle", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.updateOne.mockResolvedValue({ matchedCount: 1 });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function mockAdmin() {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
  }

  it("GET reports the current state on production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await mockAdmin();
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current" });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.enabled).toBe(false);
    expect(data.enableBlocked).toBeUndefined();
  });

  it("POST allows enabling on production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await mockAdmin();

    const { POST } = await import("./route");
    const res = await POST(makePost(true));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.conflictsEnabled).toBe(true);
    expect(db.collectionMocks.gameState.updateOne).toHaveBeenCalledTimes(1);
  });

  it("POST still allows disabling on production builds", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await mockAdmin();

    const { POST } = await import("./route");
    const res = await POST(makePost(false));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.conflictsEnabled).toBe(false);
    expect(db.collectionMocks.gameState.updateOne).toHaveBeenCalledTimes(1);
  });

  it("POST allows enabling outside production", async () => {
    await mockAdmin();

    const { POST } = await import("./route");
    const res = await POST(makePost(true));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.conflictsEnabled).toBe(true);
    expect(db.collectionMocks.gameState.updateOne).toHaveBeenCalledTimes(1);
  });

  it("POST rejects non-admins", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(makePost(true));

    expect(res.status).toBe(403);
  });
});
