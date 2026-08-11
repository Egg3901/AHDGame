import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/api/parliamentaryFreeze", () => ({
  checkLegislationFreeze: vi.fn().mockResolvedValue({ ok: true }),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();

  db.collection("bills");
  db.collection("governmentFormations");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
});

describe("POST /api/country/[code]/legislature/cabinet-bills/[id]/vote", () => {
  it("rejects a raced second vote when the atomic no-prior-vote claim loses", async () => {
    const characterId = new ObjectId("507f1f77bcf86cd799439021");
    const billId = new ObjectId("507f1f77bcf86cd799439031");

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        character: {
          _id: characterId,
          name: "Prime Minister Test",
          countryId: "JP",
        },
      },
    } as never);

    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      countryId: "JP",
      status: "cabinet_review",
      votes: {},
      votesFor: 0,
      votesAgainst: 0,
    });
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "JP",
      pmCharacterId: characterId,
    });
    db.collectionMocks["bills"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/country/jp/legislature/cabinet-bills/1/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: "for" }),
      }),
      { params: Promise.resolve({ code: "jp", id: billId.toString() }) }
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "You have already voted on this bill",
    });
    expect(db.collectionMocks["bills"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: billId,
        status: "cabinet_review",
        [`votes.${characterId.toString()}`]: { $exists: false },
      }),
      expect.any(Object)
    );
  });
});
