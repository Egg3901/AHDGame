import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function makePost(body: unknown): Request {
  return new Request("http://localhost/api/admin/conflicts/npp-offensives/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/conflicts/npp-offensives/toggle", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.updateOne.mockResolvedValue({ matchedCount: 1 });
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

  it("GET reports both switches off when the row has never been written", async () => {
    // The default matters more than usual here: an unconfigured world must not send
    // NPP armies on the attack without a general or a technology model behind them.
    await mockAdmin();
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current" });

    const { GET } = await import("./route");
    const data = await (await GET()).json();

    expect(data.initiation.enabled).toBe(false);
    expect(data.join.enabled).toBe(false);
  });

  it("GET reports each switch and its attribution independently", async () => {
    await mockAdmin();
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      nppOffensiveInitiationEnabled: true,
      nppOffensiveInitiationEnabledBy: "admin",
      nppOffensiveInitiationEnabledAt: "2026-08-31T00:00:00.000Z",
      nppOffensiveJoinEnabled: false,
    });

    const { GET } = await import("./route");
    const data = await (await GET()).json();

    expect(data.initiation).toEqual({
      enabled: true,
      enabledBy: "admin",
      enabledAt: "2026-08-31T00:00:00.000Z",
    });
    expect(data.join.enabled).toBe(false);
    expect(data.join.enabledBy).toBeNull();
  });

  it("POST writes only the named switch, leaving the other alone", async () => {
    await mockAdmin();

    const { POST } = await import("./route");
    const res = await POST(makePost({ flag: "join", enabled: true }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toMatchObject({ success: true, flag: "join", enabled: true });
    const [, update] = db.collectionMocks.gameState.updateOne.mock.calls[0];
    expect(update.$set.nppOffensiveJoinEnabled).toBe(true);
    expect(update.$set.nppOffensiveJoinEnabledBy).toBe("admin");
    expect(update.$set).not.toHaveProperty("nppOffensiveInitiationEnabled");
  });

  it("POST clears the attribution when a switch is turned off", async () => {
    await mockAdmin();

    const { POST } = await import("./route");
    const res = await POST(makePost({ flag: "initiation", enabled: false }));

    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.gameState.updateOne.mock.calls[0];
    expect(update.$set.nppOffensiveInitiationEnabled).toBe(false);
    expect(update.$unset).toEqual({
      nppOffensiveInitiationEnabledBy: "",
      nppOffensiveInitiationEnabledAt: "",
    });
  });

  it("POST rejects an unknown flag name", async () => {
    await mockAdmin();

    const { POST } = await import("./route");
    const res = await POST(makePost({ flag: "everything", enabled: true }));

    expect(res.status).toBe(400);
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });

  it("POST rejects non-admins", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(makePost({ flag: "join", enabled: true }));

    expect(res.status).toBe(403);
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });
});
