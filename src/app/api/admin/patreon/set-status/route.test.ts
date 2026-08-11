import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn() }));
vi.mock("@/lib/patreon/service", () => ({ applyPatreonStatus: vi.fn() }));

describe("POST /api/admin/patreon/set-status", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    db.collection("characters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("rejects non-admins", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/admin/patreon/set-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: new ObjectId().toString(), tier: "supporter" }),
      })
    );

    expect(res.status).toBe(403);
  });

  it("updates patreon status for a valid user", async () => {
    const userId = new ObjectId();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { applyPatreonStatus } = await import("@/lib/patreon/service");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      username: "eggmaster",
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: new ObjectId(),
      userId,
      name: "John Doe",
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/admin/patreon/set-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId.toString(),
          tier: "supporter-plus",
          patreonUserId: "patron-123",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(applyPatreonStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId,
        tier: "supporter-plus",
        patreonUserId: "patron-123",
      })
    );
  });

  it("returns 404 when target user does not exist", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/admin/patreon/set-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: new ObjectId().toString(), tier: null }),
      })
    );

    expect(res.status).toBe(404);
  });
});
