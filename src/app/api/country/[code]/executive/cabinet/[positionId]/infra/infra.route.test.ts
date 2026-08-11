import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");

const START = "@/app/api/country/[code]/executive/cabinet/[positionId]/infra/start/route";
const FUNDING =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/infra/[projectId]/funding/route";
const PROJECT = "@/app/api/country/[code]/executive/cabinet/[positionId]/infra/[projectId]/route";

const VALID_OID = "507f1f77bcf86cd799439011";

function jsonReq(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const seatParams = (positionId = "secretary_of_transportation") => ({
  params: Promise.resolve({ code: "us", positionId }),
});
const projParams = (positionId = "secretary_of_transportation", projectId = VALID_OID) => ({
  params: Promise.resolve({ code: "us", positionId, projectId }),
});

describe("infra routes", () => {
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
    db.collection("infraProjects");
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
    db.collectionMocks.infraProjects.insertOne.mockResolvedValue({ acknowledged: true });
  });

  describe("POST infra/start", () => {
    const good = { archetypeId: "highway", regionId: "US-CA", name: "I-95 Widening" };

    it("401s when unauthenticated", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        ok: false,
        response: new Response(null, { status: 401 }),
      } as never);
      const { POST } = await import(START);
      expect((await POST(jsonReq(good), seatParams())).status).toBe(401);
    });
    it("400s an invalid country", async () => {
      const { POST } = await import(START);
      const res = await POST(jsonReq(good), {
        params: Promise.resolve({ code: "zz", positionId: "secretary_of_transportation" }),
      });
      expect(res.status).toBe(400);
    });
    it("404s a non-transport seat", async () => {
      const { POST } = await import(START);
      expect((await POST(jsonReq(good), seatParams("secretary_of_state"))).status).toBe(404);
    });
    it("starts a project (construction) and spends an action", async () => {
      const { POST } = await import(START);
      const res = await POST(jsonReq(good), seatParams());
      expect(res.status).toBe(200);
      expect(db.collectionMocks.infraProjects.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          countryId: "US",
          positionId: "secretary_of_transportation",
          archetypeId: "highway",
          status: "construction",
          progress: 0,
          regionId: "US-CA",
        })
      );
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "member_1", ministerialActions: { $gte: 1 } },
        { $inc: { ministerialActions: -1 } }
      );
    });
    it("400s an invalid project type", async () => {
      const { POST } = await import(START);
      expect((await POST(jsonReq({ ...good, archetypeId: "monorail" }), seatParams())).status).toBe(
        400
      );
    });
    it("400s a region not in the country", async () => {
      db.collectionMocks.states.findOne.mockResolvedValue(null);
      const { POST } = await import(START);
      const res = await POST(jsonReq(good), seatParams());
      expect(res.status).toBe(400);
      expect(db.collectionMocks.infraProjects.insertOne).not.toHaveBeenCalled();
    });
    it("403s a non-holder non-admin", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        ok: true,
        user: { isAdmin: false, character: { _id: "someone_else" } },
      } as never);
      const { POST } = await import(START);
      expect((await POST(jsonReq(good), seatParams())).status).toBe(403);
    });
    it("rolls the action back if the insert throws", async () => {
      db.collectionMocks.infraProjects.insertOne.mockRejectedValue(new Error("boom"));
      const { POST } = await import(START);
      const res = await POST(jsonReq(good), seatParams());
      expect(res.status).toBe(500);
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "member_1" },
        { $inc: { ministerialActions: 1 } }
      );
    });
  });

  describe("POST infra/[projectId]/funding", () => {
    beforeEach(() => {
      db.collectionMocks.infraProjects.findOne.mockResolvedValue({
        _id: VALID_OID,
        status: "construction",
      });
    });
    it("400s an invalid project id", async () => {
      const { POST } = await import(FUNDING);
      expect(
        (
          await POST(
            jsonReq({ fundingLevel: "crashed" }),
            projParams("secretary_of_transportation", "nope")
          )
        ).status
      ).toBe(400);
    });
    it("sets the build funding", async () => {
      const { POST } = await import(FUNDING);
      const res = await POST(jsonReq({ fundingLevel: "crashed" }), projParams());
      expect(res.status).toBe(200);
      expect(db.collectionMocks.infraProjects.updateOne).toHaveBeenCalledWith(
        { _id: VALID_OID },
        { $set: { fundingLevel: "crashed" } }
      );
    });
    it("400s when the project is already operational", async () => {
      db.collectionMocks.infraProjects.findOne.mockResolvedValue({
        _id: VALID_OID,
        status: "operational",
      });
      const { POST } = await import(FUNDING);
      expect((await POST(jsonReq({ fundingLevel: "slowed" }), projParams())).status).toBe(400);
    });
    it("400s an invalid funding level", async () => {
      const { POST } = await import(FUNDING);
      expect((await POST(jsonReq({ fundingLevel: "turbo" }), projParams())).status).toBe(400);
    });
    it("404s a missing project", async () => {
      db.collectionMocks.infraProjects.findOne.mockResolvedValue(null);
      const { POST } = await import(FUNDING);
      expect((await POST(jsonReq({ fundingLevel: "slowed" }), projParams())).status).toBe(404);
    });
  });

  describe("DELETE infra/[projectId]", () => {
    it("cancels/retires a project", async () => {
      const { DELETE } = await import(PROJECT);
      const res = await DELETE(
        new Request("http://localhost/x", { method: "DELETE" }),
        projParams()
      );
      expect(res.status).toBe(200);
      expect(db.collectionMocks.infraProjects.deleteOne).toHaveBeenCalledWith({
        _id: expect.anything(),
        countryId: "US",
        positionId: "secretary_of_transportation",
      });
    });
    it("404s a missing project", async () => {
      db.collectionMocks.infraProjects.deleteOne.mockResolvedValue({ deletedCount: 0 });
      const { DELETE } = await import(PROJECT);
      const res = await DELETE(
        new Request("http://localhost/x", { method: "DELETE" }),
        projParams()
      );
      expect(res.status).toBe(404);
    });
  });
});
