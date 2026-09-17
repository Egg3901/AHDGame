import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

describe("POST /api/corporations/[id]/bank/lending-profile", () => {
  let db: MockDb;
  let corpId: ObjectId;
  let userId: ObjectId;

  const charter = (overrides: Record<string, unknown> = {}) => ({
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 10_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    lendingProfile: "balanced",
    ...overrides,
  });

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

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString(), isAdmin: false },
    } as never);
  });

  const post = (profile: unknown) =>
    import("./route").then(({ POST }) =>
      POST(
        new Request(`http://localhost/api/corporations/${corpId}/bank/lending-profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile }),
        }),
        { params: Promise.resolve({ id: corpId.toString() }) }
      )
    );

  const mockBank = (bankCharter: Record<string, unknown>) => {
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: corpId,
      name: "Bank",
      userId,
      ceoId: userId,
      liquidCapital: 50_000_000,
      bankCharter,
    });
    db.collectionMocks.corporations!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    } as never);
  };

  it("rejects an unknown profile", async () => {
    mockBank(charter());
    const res = await post("reckless");
    expect(res.status).toBe(400);
  });

  it("rejects a charter that cannot originate household loans", async () => {
    mockBank(charter({ type: "investment" }));
    const res = await post("aggressive");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/retail or universal/);
  });

  it("persists the stance and names the bands that start building", async () => {
    mockBank(charter({ lendingProfile: "balanced" }));
    let saved: unknown;
    db.collectionMocks.corporations!.updateOne.mockImplementation(async (_f, update) => {
      saved = (update as { $set?: Record<string, unknown> }).$set?.["bankCharter.lendingProfile"];
      return { matchedCount: 1, modifiedCount: 1 } as never;
    });

    const res = await post("aggressive");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      lendingProfile: string;
      openBands: string[];
      newlyOpened: string[];
      enteringRunoff: string[];
      flowCapFraction: number;
      message: string;
    };
    expect(json.success).toBe(true);
    expect(saved).toBe("aggressive");
    expect(json.openBands).toEqual(["AAA", "AA", "A", "BBB", "BB", "B", "CCC"]);
    expect(json.newlyOpened).toEqual(["BB", "B", "CCC"]);
    expect(json.enteringRunoff).toEqual([]);
    expect(json.flowCapFraction).toBeGreaterThan(0);
    expect(json.message).toMatch(/BB/);
    expect(json.message).toMatch(/dozens of turns/);
  });

  it("names the bands entering runoff when tightening the stance", async () => {
    mockBank(charter({ lendingProfile: "aggressive" }));
    const res = await post("conservative");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      newlyOpened: string[];
      enteringRunoff: string[];
      message: string;
    };
    expect(json.newlyOpened).toEqual([]);
    expect(json.enteringRunoff).toEqual(["BBB", "BB", "B", "CCC"]);
    expect(json.message).toMatch(/runs off gradually/);
  });

  it("reports an unchanged stance without movers", async () => {
    mockBank(charter({ lendingProfile: "balanced" }));
    const res = await post("balanced");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      newlyOpened: string[];
      enteringRunoff: string[];
      message: string;
    };
    expect(json.newlyOpened).toEqual([]);
    expect(json.enteringRunoff).toEqual([]);
    expect(json.message).toMatch(/unchanged/);
  });
});
