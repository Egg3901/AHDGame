import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));

describe("PATCH /api/settings/patreon", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("rejects unauthenticated users", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
      }),
    } as never);

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/settings/patreon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adsDisabled: true }),
      })
    );

    expect(res.status).toBe(401);
  }, 10000);

  it("updates supporter preferences", async () => {
    const userId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      patreonTier: "supporter",
      patreonExpiresAt: null,
      adsDisabled: true,
      patreonAdPreference: "ad-free",
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/settings/patreon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patreonAdPreference: "player-only",
          patreonHighlightColor: "#d4a24c",
        }),
      })
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.users.updateOne).toHaveBeenCalled();
  });

  it("allows static border updates for supporters", async () => {
    const userId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      patreonTier: "supporter",
      patreonExpiresAt: null,
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/settings/patreon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patreonProfileBorder: "soft-glow" }),
      })
    );

    expect(res.status).toBe(200);
  });

  it("rejects animated border updates for non-supporter-plus patrons", async () => {
    const userId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      patreonTier: "supporter",
      patreonExpiresAt: null,
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/settings/patreon", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patreonProfileBorder: "prism" }),
      })
    );

    expect(res.status).toBe(403);
  });
});
