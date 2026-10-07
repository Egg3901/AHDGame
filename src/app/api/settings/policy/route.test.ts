import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/achievements", () => ({ awardAchievement: vi.fn() }));

describe("POST /api/settings/policy", () => {
  let db: MockDb;
  let characterId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: {
          _id: characterId,
          policies: { economic: 0, social: 0 },
        },
      },
    } as never);
  });

  function request(body: unknown) {
    return new Request("http://localhost/api/settings/policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("atomically consumes one voucher without applying standard costs", async () => {
    db.collection("characters");
    db.collectionMocks.characters!.findOneAndUpdate.mockResolvedValue({
      _id: characterId,
      policies: { economic: 1, social: 0 },
      actions: 2,
      infamy: 8,
      politicalInfluence: 90,
      nationalInfluence: 70,
      positionUpdateVouchers: 1,
    });

    const { POST } = await import("./route");
    const response = await POST(request({ axis: "economic", direction: 1, useVoucher: true }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.usedVoucher).toBe(true);
    expect(data.stats.positionUpdateVouchers).toBe(1);

    const [filter, pipeline] = db.collectionMocks.characters!.findOneAndUpdate.mock.calls[0]!;
    expect(filter).toEqual({
      _id: characterId,
      positionUpdateVouchers: { $gte: 1 },
      "policies.economic": { $lt: 5 },
    });
    const setStage = pipeline[0].$set;
    expect(setStage.positionUpdateVouchers).toEqual({
      $subtract: [{ $ifNull: ["$positionUpdateVouchers", 0] }, 1],
    });
    expect(setStage["policies.economic"]).toEqual({ $add: ["$policies.economic", 1] });
    expect(setStage).not.toHaveProperty("actions");
    expect(setStage).not.toHaveProperty("infamy");
    expect(setStage).not.toHaveProperty("politicalInfluence");
    expect(setStage).not.toHaveProperty("nationalInfluence");
  });

  it("rejects voucher use when the atomic balance check fails", async () => {
    db.collection("characters");
    db.collectionMocks.characters!.findOneAndUpdate.mockResolvedValue(null);
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      policies: { economic: 0, social: 0 },
      actions: 100,
      positionUpdateVouchers: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(request({ axis: "social", direction: -1, useVoucher: true }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/no positions update vouchers/i);
  });

  it("retains the standard action and penalty path when no voucher is selected", async () => {
    db.collection("characters");
    db.collectionMocks.characters!.findOneAndUpdate.mockResolvedValue({
      _id: characterId,
      policies: { economic: 0, social: 1 },
      actions: 35,
      infamy: 10,
      politicalInfluence: 95,
      nationalInfluence: 76,
      positionUpdateVouchers: 2,
    });

    const { POST } = await import("./route");
    const response = await POST(request({ axis: "social", direction: 1 }));

    expect(response.status).toBe(200);
    const [filter, pipeline] = db.collectionMocks.characters!.findOneAndUpdate.mock.calls[0]!;
    expect(filter.actions).toEqual({ $gte: 15 });
    expect(filter).not.toHaveProperty("positionUpdateVouchers");
    expect(pipeline[0].$set.actions).toEqual({ $subtract: ["$actions", 15] });
    expect(pipeline[0].$set.positionUpdateVouchers).toBeUndefined();
  });
});
