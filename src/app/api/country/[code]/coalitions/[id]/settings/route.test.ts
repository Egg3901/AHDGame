import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
const chair = new ObjectId();
const coalitionId = new ObjectId();
let db: MockDb;
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("coalitions");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: chair.toString(), character: { _id: chair, countryId: "UK" } },
  } as never);
  db.collectionMocks.coalitions!.findOne.mockResolvedValueOnce({
    _id: coalitionId,
    chairCharacterId: chair,
  });
  db.collectionMocks.coalitions!.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
});
async function patch(body: object) {
  const { PATCH } = await import("./route");
  return PATCH(
    new Request("http://localhost/api/country/uk/coalitions/1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code: "uk", id: "1" }) }
  );
}
describe("coalition identity settings", () => {
  it("trims and saves identity with an atomic chair guard", async () => {
    const response = await patch({
      name: "  New Alliance  ",
      abbreviation: " NA ",
      color: "#123abc",
    });
    expect(response.status).toBe(200);
    expect(db.collectionMocks.coalitions!.updateOne).toHaveBeenCalledWith(
      { _id: coalitionId, countryId: "UK", chairCharacterId: chair },
      {
        $set: expect.objectContaining({
          name: "New Alliance",
          abbreviation: "NA",
          color: "#123abc",
        }),
      }
    );
    expect(db.collectionMocks.coalitions!.findOne).toHaveBeenLastCalledWith({
      _id: { $ne: coalitionId },
      countryId: "UK",
      name: { $regex: /^New Alliance$/i },
    });
  });
  it.each([{ name: "   " }, { abbreviation: " x " }, { color: "red" }])(
    "rejects invalid identity %j",
    async (body) => {
      expect((await patch(body)).status).toBe(400);
      expect(db.collectionMocks.coalitions!.updateOne).not.toHaveBeenCalled();
    }
  );
  it("rejects another coalition's name", async () => {
    db.collectionMocks.coalitions!.findOne.mockResolvedValueOnce({ _id: new ObjectId() });
    expect((await patch({ name: "Existing" })).status).toBe(400);
    expect(db.collectionMocks.coalitions!.updateOne).not.toHaveBeenCalled();
  });
  it("rejects non-chair users", async () => {
    db.collectionMocks
      .coalitions!.findOne.mockReset()
      .mockResolvedValue({ _id: coalitionId, chairCharacterId: new ObjectId() });
    expect((await patch({ color: "#123456" })).status).toBe(403);
    expect(db.collectionMocks.coalitions!.updateOne).not.toHaveBeenCalled();
  });
  it("rejects a chair change during the request", async () => {
    db.collectionMocks.coalitions!.updateOne.mockResolvedValue({ matchedCount: 0 });
    expect((await patch({ color: "#123456" })).status).toBe(403);
  });
  it("retains Discord-only updates", async () => {
    expect((await patch({ discordInviteUrl: null })).status).toBe(200);
    expect(db.collectionMocks.coalitions!.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({ discordInviteUrl: null }),
    });
  });
});
