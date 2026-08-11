import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("gameConfig");
});

async function setupAdminOk() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: "admin", username: "adminuser", isAdmin: true },
  } as never);
}

describe("GET /api/admin/party/first-joiner-chair", () => {
  it("returns enabled true when field is unset (legacy)", async () => {
    await setupAdminOk();
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({ _id: "default" });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.enabled).toBe(true);
  });

  it("returns enabled false when explicitly disabled", async () => {
    await setupAdminOk();
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      firstJoinerBecomesPartyChair: false,
    });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.enabled).toBe(false);
  });
});

describe("PATCH /api/admin/party/first-joiner-chair", () => {
  it("persists enabled false", async () => {
    await setupAdminOk();

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.enabled).toBe(false);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      { $set: { firstJoinerBecomesPartyChair: false } },
      { upsert: true }
    );
  });

  it("returns 400 for invalid body", async () => {
    await setupAdminOk();

    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(400);
  });
});
