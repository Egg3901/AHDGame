import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAdmin } = await import("@/lib/api/requireAdmin");

let db: MockDb;

function post(body: unknown) {
  return new Request("http://t", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { username: "root" },
  } as never);
  db.collection("gameState");
  db.collectionMocks.gameState.findOne.mockResolvedValue({});
  db.collectionMocks.gameState.updateOne.mockResolvedValue({ matchedCount: 1 });
});

describe("NPP intelligence switch", () => {
  it("reads as OFF in a world that has never been configured", async () => {
    // Fails closed on purpose: this switch points the NPP world at players, and
    // an absent field must never read as permission.
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.operations.enabled).toBe(false);
    expect(body.operations.enabledBy).toBeNull();
  });

  it("reads a legacy string value as OFF, not as truthy", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      nppIntelligenceOperationsEnabled: "true",
    });
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.operations.enabled).toBe(false);
  });

  it("refuses a non-admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const { POST } = await import("./route");
    expect((await POST(post({ enabled: true }))).status).toBe(403);
  });

  it("rejects a body that is not a boolean", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ enabled: "yes" }))).status).toBe(400);
  });

  it("stamps who turned it on", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ enabled: true }));
    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.gameState.updateOne.mock.calls[0];
    expect(update.$set.nppIntelligenceOperationsEnabled).toBe(true);
    expect(update.$set.nppIntelligenceOperationsEnabledBy).toBe("root");
  });

  it("clears the attribution when turned back off", async () => {
    const { POST } = await import("./route");
    await POST(post({ enabled: false }));
    const [, update] = db.collectionMocks.gameState.updateOne.mock.calls[0];
    expect(update.$set.nppIntelligenceOperationsEnabled).toBe(false);
    expect(update.$unset).toHaveProperty("nppIntelligenceOperationsEnabledBy");
  });
});
