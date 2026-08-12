import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

describe("PUT /api/corporations/[id]/bank/capacity", () => {
  let db: MockDb;
  let corpId: ObjectId;
  let userId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameConfig");
    db.collection("corporations");
    corpId = new ObjectId();
    userId = new ObjectId();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
    });
  });

  it("rejects branchCapacityShare outside 0.1..0.9", async () => {
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);

    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: corpId,
      name: "Bank",
      userId,
      ceoId: userId,
      liquidCapital: 50_000_000,
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 10_000_000,
        depositOffset: 0,
        lendingOffset: 0,
      },
    });

    const { PUT } = await import("./route");
    const res = await PUT(
      new Request(`http://localhost/api/corporations/${corpId}/bank/capacity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchCapacityShare: 0.05 }),
      }),
      { params: Promise.resolve({ id: corpId.toString() }) }
    );
    expect(res.status).toBe(400);
  });

  it("accepts a valid share and persists it", async () => {
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);

    let savedShare: number | undefined;
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: corpId,
      name: "Bank",
      userId,
      ceoId: userId,
      liquidCapital: 50_000_000,
      bankCharter: {
        type: "retail",
        status: "active",
        currency: "USD",
        charteredTurn: 1,
        postedCapital: 10_000_000,
        depositOffset: 0,
        lendingOffset: 0,
      },
    });
    db.collectionMocks.corporations!.updateOne.mockImplementation(async (_f, update) => {
      const set = (update as { $set?: Record<string, number> }).$set;
      savedShare = set?.["bankCharter.branchCapacityShare"];
      return { matchedCount: 1, modifiedCount: 1 };
    });

    const { PUT } = await import("./route");
    const res = await PUT(
      new Request(`http://localhost/api/corporations/${corpId}/bank/capacity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchCapacityShare: 0.35 }),
      }),
      { params: Promise.resolve({ id: corpId.toString() }) }
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; branchCapacityShare: number };
    expect(json.success).toBe(true);
    expect(json.branchCapacityShare).toBe(0.35);
    expect(savedShare).toBe(0.35);
  });
});
