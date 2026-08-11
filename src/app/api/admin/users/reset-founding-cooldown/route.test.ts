import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/users/reset-founding-cooldown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/users/reset-founding-cooldown", () => {
  let db: MockDb;
  let userId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    db.collection("adminLogs");
    userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: userId,
      username: "north",
      lastCorporationFoundedTurn: 6,
    });
  });

  it("rejects a non-admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ userId: userId.toString() }));
    expect(res.status).toBe(403);
  });

  it("rejects a malformed user id", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ userId: "not-an-objectid" }));
    expect(res.status).toBe(400);
    expect(db.collectionMocks["users"]!.updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not exist", async () => {
    db.collectionMocks["users"]!.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ userId: userId.toString() }));
    expect(res.status).toBe(404);
    expect(db.collectionMocks["users"]!.updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when no cooldown is set", async () => {
    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: userId,
      username: "north",
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ userId: userId.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/no founding cooldown/i);
    expect(db.collectionMocks["users"]!.updateOne).not.toHaveBeenCalled();
  });

  // Turn 0 is falsy but is a real cooldown stamp — the guard must be a null
  // check, not a truthiness check.
  it("clears a cooldown stamped at turn 0", async () => {
    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: userId,
      username: "north",
      lastCorporationFoundedTurn: 0,
    });
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ userId: userId.toString() }));
    expect(res.status).toBe(200);
    expect(db.collectionMocks["users"]!.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      { $unset: { lastCorporationFoundedTurn: "" } }
    );
  });

  it("unsets the cooldown and writes an admin log", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest({ userId: userId.toString() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/north/);
    expect(db.collectionMocks["users"]!.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      { $unset: { lastCorporationFoundedTurn: "" } }
    );
    expect(db.collectionMocks["adminLogs"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "founding_cooldown_reset",
        username: "north",
        adminUsername: "admin",
      })
    );
  });
});
