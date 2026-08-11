import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("watchlist");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

async function mockModerator(isAdmin: boolean) {
  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), username: "staff1", isAdmin },
  } as Awaited<ReturnType<typeof requireModerator>>);
}

function del(userId: string) {
  return import("./route").then(({ DELETE }) =>
    DELETE(new Request(`http://localhost/api/admin/watchlist/${userId}`, { method: "DELETE" }), {
      params: Promise.resolve({ userId }),
    })
  );
}

describe("DELETE /api/admin/watchlist/[userId]", () => {
  it("returns 403 when not a moderator/admin", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireModerator>>);

    const res = await del(new ObjectId().toString());
    expect(res.status).toBe(403);
  });

  it("rejects a malformed userId", async () => {
    await mockModerator(false);
    const res = await del("not-an-id");
    expect(res.status).toBe(400);
  });

  it("returns 404 when the user is not on the watchlist", async () => {
    await mockModerator(false);
    db.collectionMocks.watchlist!.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const res = await del(new ObjectId().toString());
    expect(res.status).toBe(404);
  });

  it("removes the entry for a moderator (not just an admin)", async () => {
    await mockModerator(false);
    const userId = new ObjectId();
    db.collectionMocks.watchlist!.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const res = await del(userId.toString());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(db.collectionMocks.watchlist!.deleteOne).toHaveBeenCalledWith({ userId });
  });

  it("removes the entry for an admin", async () => {
    await mockModerator(true);
    const userId = new ObjectId();
    db.collectionMocks.watchlist!.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const res = await del(userId.toString());
    expect(res.status).toBe(200);
  });
});
