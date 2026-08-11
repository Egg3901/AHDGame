import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");

const BUILD = "@/app/api/country/[code]/executive/cabinet/[positionId]/energy/build/route";
const UPGRADE =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/energy/[plantId]/upgrade/route";
const PLANT = "@/app/api/country/[code]/executive/cabinet/[positionId]/energy/[plantId]/route";

const VALID_OID = "507f1f77bcf86cd799439011";

function jsonReq(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const energyParams = (positionId = "secretary_of_energy") => ({
  params: Promise.resolve({ code: "us", positionId }),
});
const plantParams = (positionId = "secretary_of_energy", plantId = VALID_OID) => ({
  params: Promise.resolve({ code: "us", positionId, plantId }),
});

describe("energy routes", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 42 } as never);

    db.collection("cabinetMembers");
    db.collection("states");
    db.collection("energyPlants");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "member_1",
      characterId: "char_1",
      ministerialActions: 2,
    });
    db.collectionMocks.cabinetMembers.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "US-CA" });
    db.collectionMocks.energyPlants.insertOne.mockResolvedValue({ acknowledged: true });
  });

  describe("POST energy/build", () => {
    const good = { source: "wind", regionId: "US-CA", name: "Windy Ridge" };

    it("401s when unauthenticated", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        ok: false,
        response: new Response(null, { status: 401 }),
      } as never);
      const { POST } = await import(BUILD);
      expect((await POST(jsonReq(good), energyParams())).status).toBe(401);
    });
    it("400s an invalid country", async () => {
      const { POST } = await import(BUILD);
      const res = await POST(jsonReq(good), {
        params: Promise.resolve({ code: "zz", positionId: "secretary_of_energy" }),
      });
      expect(res.status).toBe(400);
    });
    it("404s a non-energy seat", async () => {
      const { POST } = await import(BUILD);
      expect((await POST(jsonReq(good), energyParams("secretary_of_state"))).status).toBe(404);
    });
    it("builds a plant and spends an action", async () => {
      const { POST } = await import(BUILD);
      const res = await POST(jsonReq(good), energyParams());
      expect(res.status).toBe(200);
      expect(db.collectionMocks.energyPlants.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          countryId: "US",
          positionId: "secretary_of_energy",
          source: "wind",
          tier: 0,
          regionId: "US-CA",
        })
      );
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "member_1", ministerialActions: { $gte: 1 } },
        { $inc: { ministerialActions: -1 } }
      );
    });
    it("400s an invalid source", async () => {
      const { POST } = await import(BUILD);
      expect((await POST(jsonReq({ ...good, source: "fusion" }), energyParams())).status).toBe(400);
    });
    it("400s a region not in the country", async () => {
      db.collectionMocks.states.findOne.mockResolvedValue(null);
      const { POST } = await import(BUILD);
      const res = await POST(jsonReq(good), energyParams());
      expect(res.status).toBe(400);
      expect(db.collectionMocks.energyPlants.insertOne).not.toHaveBeenCalled();
    });
    it("403s a non-holder non-admin", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        ok: true,
        user: { isAdmin: false, character: { _id: "someone_else" } },
      } as never);
      const { POST } = await import(BUILD);
      expect((await POST(jsonReq(good), energyParams())).status).toBe(403);
    });
    it("rolls the action back if the insert throws", async () => {
      db.collectionMocks.energyPlants.insertOne.mockRejectedValue(new Error("boom"));
      const { POST } = await import(BUILD);
      const res = await POST(jsonReq(good), energyParams());
      expect(res.status).toBe(500);
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "member_1" },
        { $inc: { ministerialActions: 1 } }
      );
    });
  });

  describe("POST energy/[plantId]/upgrade", () => {
    beforeEach(() => {
      db.collectionMocks.energyPlants.findOne.mockResolvedValue({ _id: VALID_OID, tier: 1 });
    });
    it("400s an invalid plant id", async () => {
      const { POST } = await import(UPGRADE);
      expect((await POST(jsonReq({}), plantParams("secretary_of_energy", "nope"))).status).toBe(
        400
      );
    });
    it("raises tier and spends an action", async () => {
      const { POST } = await import(UPGRADE);
      const res = await POST(jsonReq({}), plantParams());
      expect(res.status).toBe(200);
      expect(db.collectionMocks.energyPlants.updateOne).toHaveBeenCalledWith(
        { _id: VALID_OID },
        { $set: { tier: 2 } }
      );
    });
    it("400s at the top tier", async () => {
      db.collectionMocks.energyPlants.findOne.mockResolvedValue({ _id: VALID_OID, tier: 3 });
      const { POST } = await import(UPGRADE);
      expect((await POST(jsonReq({}), plantParams())).status).toBe(400);
    });
    it("404s a missing plant", async () => {
      db.collectionMocks.energyPlants.findOne.mockResolvedValue(null);
      const { POST } = await import(UPGRADE);
      expect((await POST(jsonReq({}), plantParams())).status).toBe(404);
    });
  });

  describe("DELETE energy/[plantId]", () => {
    it("retires a plant", async () => {
      const { DELETE } = await import(PLANT);
      const res = await DELETE(
        new Request("http://localhost/x", { method: "DELETE" }),
        plantParams()
      );
      expect(res.status).toBe(200);
      expect(db.collectionMocks.energyPlants.deleteOne).toHaveBeenCalledWith({
        _id: expect.anything(),
        countryId: "US",
        positionId: "secretary_of_energy",
      });
    });
    it("404s a missing plant", async () => {
      db.collectionMocks.energyPlants.deleteOne.mockResolvedValue({ deletedCount: 0 });
      const { DELETE } = await import(PLANT);
      const res = await DELETE(
        new Request("http://localhost/x", { method: "DELETE" }),
        plantParams()
      );
      expect(res.status).toBe(404);
    });
  });
});
