import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/generals/route";

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const RECRUIT = "507f1f77bcf86cd799439011";
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("POST commission a general", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "secdef" } },
    } as never);
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("characters");
    db.collection("characterGenerals");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: true,
      currentTurn: 40,
    });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "secdef",
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: RECRUIT,
      name: "Jane Doe",
      countryId: "US",
    });
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue(null); // not yet commissioned
    db.collectionMocks.characterGenerals.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("commissions a character of the secdef's own country", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: RECRUIT }), call);
    expect(res.status).toBe(200);
    const update = db.collectionMocks.characterGenerals.updateOne.mock.calls[0][1];
    expect(update.$set.commissioned).toBe(true);
    expect(update.$set.commissionedByCharacterId).toBe("secdef");
    // A fresh commission gets a real level-1 profile; specialisation derives from
    // what they train, so none is stored.
    expect(update.$setOnInsert.general.level).toBe(1);
    expect(update.$setOnInsert.general.gtraits).toEqual([]);
    expect(update.$setOnInsert.general).not.toHaveProperty("spec");
  });

  it("403s an acting secretary, and does not touch the corps", async () => {
    // Suggestion #315: the general corps outlasts a caretaker appointment, so
    // commissioning is closed until the Senate confirms. Asserted at the route
    // rather than only on the guard, because the guard is only worth anything
    // if it actually sits in this path.
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "secdef",
      acting: true,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: RECRUIT }), call);
    expect(res.status).toBe(403);
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
  });

  it("still commissions for a confirmed secretary with no acting flag", async () => {
    // The absent-field case is the one that matters: every member seated before
    // acting appointments existed lacks it, and reading absent as acting would
    // lock every sitting cabinet in the world.
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: RECRUIT }), call);
    expect(res.status).toBe(200);
  });

  it("400s commissioning a character of another country", async () => {
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: RECRUIT,
      name: "Hans",
      countryId: "DE",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: RECRUIT }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
  });

  it("400s a character who already holds a commission", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: RECRUIT,
      general: null,
      commissioned: true,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: RECRUIT }), call);
    expect(res.status).toBe(400);
  });

  // Dismissal preserves the record, so re-appointing a veteran restores it rather
  // than resetting them to level 1 with a fresh spec choice.
  it("restores a dismissed veteran's record on re-appointment", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: RECRUIT,
      general: { spec: "armor", level: 4, xp: 30, traits: ["breakthrough"], pts: 1 },
      commissioned: false,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: RECRUIT }), call);
    expect(res.status).toBe(200);
    const update = db.collectionMocks.characterGenerals.updateOne.mock.calls[0][1];
    expect(update.$set.commissioned).toBe(true);
    // The retained profile must not be clobbered back to null/level 1. $setOnInsert
    // carries `general: null` but Mongo applies it only on insert, so an existing
    // veteran's record survives; the invariant is that $set never touches `general`.
    expect(update.$set.general).toBeUndefined();
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "nobody" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: RECRUIT }), call);
    expect(res.status).toBe(403);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: RECRUIT }), call);
    expect(res.status).toBe(404);
  });

  it("404s a well-formed id that matches no character", async () => {
    db.collectionMocks.characters.findOne.mockResolvedValue(null);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: "507f1f77bcf86cd799439099" }), call);
    expect(res.status).toBe(404);
  });

  it("400s a malformed character id rather than crashing", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ characterId: "not-an-objectid" }), call);
    expect(res.status).toBe(400);
  });
});
