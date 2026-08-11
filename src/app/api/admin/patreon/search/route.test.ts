import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

describe("GET /api/admin/patreon/search", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    db.collection("characters");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 403 for non-admins", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/patreon/search?q=egg"));

    expect(res.status).toBe(403);
  });

  it("returns merged username and character matches", async () => {
    const userId = new ObjectId();
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);

    db.collectionMocks.users.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: userId, username: "eggmaster", patreonTier: "supporter" }]),
      limit: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ _id: userId, username: "eggmaster", patreonTier: "supporter" }]),
      }),
    });
    db.collectionMocks.characters.find.mockReturnValue({
      limit: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: new ObjectId(), userId, name: "John Doe" }]),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/patreon/search?q=egg"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.users).toHaveLength(1);
    expect(json.users[0]).toMatchObject({
      username: "eggmaster",
      characterName: "John Doe",
      patreonTier: "supporter",
    });
  });
});
