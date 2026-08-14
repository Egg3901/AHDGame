import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn(async () => undefined) }));

function makePatchRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/config/freight-settlement", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/PATCH /api/admin/config/freight-settlement", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameConfig");
    db.collection("gameState");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "operator" },
    } as never);

    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 482,
    });
  });

  it("defaults an absent mode to shadow", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({ _id: "default" });

    const { GET } = await import("./route");
    const res = await GET();

    expect((await res.json()) as { mode: string }).toEqual({ mode: "shadow" });
  });

  it("activates only when market throughput exists and stamps the rollout turn", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "plants",
      freightSettlementMode: "shadow",
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "active" }));

    expect(res.status).toBe(200);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      {
        $set: expect.objectContaining({
          freightSettlementMode: "active",
          freightSettlementModeUpdatedBy: "operator",
          freightSettlementModeUpdatedTurn: 482,
        }),
      },
      { upsert: true }
    );
  });

  it("refuses active mode below market clearing", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "realization",
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "active" }));

    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({
      error: "Freight settlement requires market system mode clearing or higher.",
    });
    expect(db.collectionMocks.gameConfig!.updateOne).not.toHaveBeenCalled();
  });

  it("keeps shadow available even when the market system is off", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      marketSystemMode: "off",
      freightSettlementMode: "active",
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchRequest({ mode: "shadow" }));

    expect(res.status).toBe(200);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      { $set: expect.objectContaining({ freightSettlementMode: "shadow" }) },
      { upsert: true }
    );
  });
});
