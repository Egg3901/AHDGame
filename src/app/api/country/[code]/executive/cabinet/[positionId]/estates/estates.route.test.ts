import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");
const { getEnabledCountryIds } = await import("@/lib/countryAccess");

const OPEN = "@/app/api/country/[code]/executive/cabinet/[positionId]/estates/open/route";
const EXPAND =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/estates/[estateId]/expand/route";
const FUND =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/estates/[estateId]/fund/route";
const ESTATE = "@/app/api/country/[code]/executive/cabinet/[positionId]/estates/[estateId]/route";

const VALID_OID = "507f1f77bcf86cd799439011";

function jsonReq(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const eduParams = (positionId = "secretary_of_education") => ({
  params: Promise.resolve({ code: "us", positionId }),
});
const eduEstateParams = (positionId = "secretary_of_education", estateId = VALID_OID) => ({
  params: Promise.resolve({ code: "us", positionId, estateId }),
});
const stateParams = (positionId = "secretary_of_state") => ({
  params: Promise.resolve({ code: "us", positionId }),
});

describe("estates routes", () => {
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
    vi.mocked(getEnabledCountryIds).mockResolvedValue([
      "US",
      "UK",
      "DE",
      "JP",
      "IE",
      "CN",
    ] as never);

    db.collection("cabinetMembers");
    db.collection("states");
    db.collection("cabinetEstates");
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
    db.collectionMocks.cabinetEstates.insertOne.mockResolvedValue({ acknowledged: true });
  });

  // ── open ────────────────────────────────────────────────────────────────
  describe("POST estates/open", () => {
    const goodDomestic = { archetypeId: "public_school", siteId: "US-CA", name: "Lincoln High" };

    it("401s when unauthenticated", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        ok: false,
        response: new Response(null, { status: 401 }),
      } as never);
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq(goodDomestic), eduParams());
      expect(res.status).toBe(401);
    });

    it("400s an invalid country", async () => {
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq(goodDomestic), {
        params: Promise.resolve({ code: "zz", positionId: "secretary_of_education" }),
      });
      expect(res.status).toBe(400);
    });

    it("404s a reserved seat", async () => {
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq(goodDomestic), eduParams("secretary_of_defense"));
      expect(res.status).toBe(404);
    });

    it("opens a domestic estate and spends an action", async () => {
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq(goodDomestic), eduParams());
      expect(res.status).toBe(200);
      expect(db.collectionMocks.cabinetEstates.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          countryId: "US",
          portfolioKey: "education",
          positionId: "secretary_of_education",
          archetypeId: "public_school",
          siteScope: "region",
          siteId: "US-CA",
          tier: 0,
          fundingLevel: "standard",
        })
      );
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "member_1", ministerialActions: { $gte: 1 } },
        { $inc: { ministerialActions: -1 } }
      );
    });

    it("400s an invalid archetype", async () => {
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq({ ...goodDomestic, archetypeId: "nope" }), eduParams());
      expect(res.status).toBe(400);
    });

    it("400s a domestic siteId not in the country", async () => {
      db.collectionMocks.states.findOne.mockResolvedValue(null);
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq(goodDomestic), eduParams());
      expect(res.status).toBe(400);
      expect(db.collectionMocks.cabinetEstates.insertOne).not.toHaveBeenCalled();
    });

    it("400s when no actions remain", async () => {
      db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
        _id: "member_1",
        characterId: "char_1",
        ministerialActions: 0,
      });
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq(goodDomestic), eduParams());
      expect(res.status).toBe(400);
    });

    it("403s a non-holder non-admin", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        ok: true,
        user: { isAdmin: false, character: { _id: "someone_else" } },
      } as never);
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq(goodDomestic), eduParams());
      expect(res.status).toBe(403);
    });

    it("rolls the action back if the insert throws", async () => {
      db.collectionMocks.cabinetEstates.insertOne.mockRejectedValue(new Error("boom"));
      const { POST } = await import(OPEN);
      const res = await POST(jsonReq(goodDomestic), eduParams());
      expect(res.status).toBe(500);
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "member_1" },
        { $inc: { ministerialActions: 1 } }
      );
    });

    it("opens a foreign estate sited abroad", async () => {
      const { POST } = await import(OPEN);
      const res = await POST(
        jsonReq({ archetypeId: "embassy", siteId: "UK", name: "Embassy London" }),
        stateParams()
      );
      expect(res.status).toBe(200);
      expect(db.collectionMocks.cabinetEstates.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ siteScope: "country", siteId: "UK", portfolioKey: "foreign" })
      );
    });

    it("400s a foreign estate sited in the home country", async () => {
      const { POST } = await import(OPEN);
      const res = await POST(
        jsonReq({ archetypeId: "embassy", siteId: "US", name: "X" }),
        stateParams()
      );
      expect(res.status).toBe(400);
    });

    it("400s a foreign estate in a non-enabled host", async () => {
      const { POST } = await import(OPEN);
      const res = await POST(
        jsonReq({ archetypeId: "embassy", siteId: "ZZ", name: "X" }),
        stateParams()
      );
      expect(res.status).toBe(400);
    });

    it("409s a duplicate archetype in the same host country", async () => {
      db.collectionMocks.cabinetEstates.findOne.mockResolvedValue({ _id: "existing" });
      const { POST } = await import(OPEN);
      const res = await POST(
        jsonReq({ archetypeId: "embassy", siteId: "UK", name: "X" }),
        stateParams()
      );
      expect(res.status).toBe(409);
      expect(db.collectionMocks.cabinetEstates.insertOne).not.toHaveBeenCalled();
    });
  });

  // ── expand ──────────────────────────────────────────────────────────────
  describe("POST estates/[estateId]/expand", () => {
    beforeEach(() => {
      db.collectionMocks.cabinetEstates.findOne.mockResolvedValue({
        _id: VALID_OID,
        tier: 1,
      });
    });

    it("400s an invalid estate id", async () => {
      const { POST } = await import(EXPAND);
      const res = await POST(jsonReq({}), eduEstateParams("secretary_of_education", "not-an-oid"));
      expect(res.status).toBe(400);
    });

    it("raises tier and spends an action", async () => {
      const { POST } = await import(EXPAND);
      const res = await POST(jsonReq({}), eduEstateParams());
      expect(res.status).toBe(200);
      expect(db.collectionMocks.cabinetEstates.updateOne).toHaveBeenCalledWith(
        { _id: VALID_OID },
        { $set: { tier: 2 } }
      );
    });

    it("400s when already at the top tier", async () => {
      db.collectionMocks.cabinetEstates.findOne.mockResolvedValue({ _id: VALID_OID, tier: 3 });
      const { POST } = await import(EXPAND);
      const res = await POST(jsonReq({}), eduEstateParams());
      expect(res.status).toBe(400);
    });

    it("404s a missing estate", async () => {
      db.collectionMocks.cabinetEstates.findOne.mockResolvedValue(null);
      const { POST } = await import(EXPAND);
      const res = await POST(jsonReq({}), eduEstateParams());
      expect(res.status).toBe(404);
    });
  });

  // ── fund ────────────────────────────────────────────────────────────────
  describe("POST estates/[estateId]/fund", () => {
    it("sets the funding level", async () => {
      const { POST } = await import(FUND);
      const res = await POST(jsonReq({ fundingLevel: "enhanced" }), eduEstateParams());
      expect(res.status).toBe(200);
      expect(db.collectionMocks.cabinetEstates.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything(), countryId: "US", positionId: "secretary_of_education" },
        { $set: { fundingLevel: "enhanced" } }
      );
    });

    it("400s an invalid funding level", async () => {
      const { POST } = await import(FUND);
      const res = await POST(jsonReq({ fundingLevel: "lavish" }), eduEstateParams());
      expect(res.status).toBe(400);
    });

    it("404s a missing estate", async () => {
      db.collectionMocks.cabinetEstates.updateOne.mockResolvedValue({
        matchedCount: 0,
        modifiedCount: 0,
      });
      const { POST } = await import(FUND);
      const res = await POST(jsonReq({ fundingLevel: "reduced" }), eduEstateParams());
      expect(res.status).toBe(404);
    });
  });

  // ── close (DELETE) ────────────────────────────────────────────────────────
  describe("DELETE estates/[estateId]", () => {
    it("closes an estate", async () => {
      const { DELETE } = await import(ESTATE);
      const res = await DELETE(
        new Request("http://localhost/x", { method: "DELETE" }),
        eduEstateParams()
      );
      expect(res.status).toBe(200);
      expect(db.collectionMocks.cabinetEstates.deleteOne).toHaveBeenCalledWith({
        _id: expect.anything(),
        countryId: "US",
        positionId: "secretary_of_education",
      });
    });

    it("404s a missing estate", async () => {
      db.collectionMocks.cabinetEstates.deleteOne.mockResolvedValue({ deletedCount: 0 });
      const { DELETE } = await import(ESTATE);
      const res = await DELETE(
        new Request("http://localhost/x", { method: "DELETE" }),
        eduEstateParams()
      );
      expect(res.status).toBe(404);
    });

    it("403s a non-holder non-admin", async () => {
      vi.mocked(requireAuth).mockResolvedValue({
        ok: true,
        user: { isAdmin: false, character: { _id: "someone_else" } },
      } as never);
      const { DELETE } = await import(ESTATE);
      const res = await DELETE(
        new Request("http://localhost/x", { method: "DELETE" }),
        eduEstateParams()
      );
      expect(res.status).toBe(403);
    });
  });
});
