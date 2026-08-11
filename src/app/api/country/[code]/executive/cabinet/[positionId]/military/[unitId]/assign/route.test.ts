import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/military/[unitId]/assign/route";

// A valid 24-hex ObjectId string.
const UNIT_ID = "a1b2c3d4e5f6a1b2c3d4e5f6";

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = {
  params: Promise.resolve({ code: "us", positionId: "secretary_of_defense", unitId: UNIT_ID }),
};

/** The $set written to militaryUnits.updateOne on the last call. */
function lastSet() {
  const calls = (db.collectionMocks.militaryUnits.updateOne as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][1].$set as { assignedGeneralId: string | null; theaterId: string };
}

let db: MockDb;
describe("POST assign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("militaryUnits");
    db.collection("militaryFormations");
    db.collection("characters");
    db.collection("characterGenerals");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.militaryUnits.updateOne.mockResolvedValue({ matchedCount: 1 });
    // Default target unit: Standard posture (won't floor) and exists.
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({ posture: "standard" });
    // gen1 is a commissioned US general posted to afghan.
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      conflictAssignments: [{ theaterId: "afghan", generalCharacterId: "gen1", inCharge: true }],
    });
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({
        toArray: vi.fn().mockResolvedValue([{ _id: "gen1", name: "Gen. One" }]),
      }),
    });
    db.collectionMocks.characterGenerals.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { characterId: "gen1", general: { name: "Gen. One", level: 2, gtraits: [] } },
        ]),
    });
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: "gen1",
      commissioned: true,
      general: { name: "Gen. One", level: 2, gtraits: [] },
    });
  });

  it("assigns a commissioned general and derives the unit's theater from their posting", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(200);
    expect(lastSet()).toEqual({ assignedGeneralId: "gen1", theaterId: "afghan" });
  });

  it("clears to General Staff and reserve when assignedGeneralId is null", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ assignedGeneralId: null }), call);
    expect(res.status).toBe(200);
    expect(lastSet()).toEqual({ assignedGeneralId: null, theaterId: "reserve" });
  });

  it("400s a general who is not commissioned, without writing", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: "gen1",
      commissioned: false,
      general: null,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  it("400s a commissioned general from another country, without writing", async () => {
    // Commissioned, but not in this country's roster.
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(403);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(404);
  });

  it("404s when the unit is not found", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue(null);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ assignedGeneralId: null }), call);
    expect(res.status).toBe(404);
  });

  it("floors a Garrison unit up to Standard when deployed to a front", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({ posture: "garrison" });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(200);
    // gen1 is posted to afghan (a front) → Garrison floors to Standard in the write.
    expect(lastSet()).toEqual({
      assignedGeneralId: "gen1",
      theaterId: "afghan",
      posture: "standard",
    });
  });

  it("does not change posture when assigning to a reserve (unposted) general", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({ posture: "garrison" });
    const { POST } = await import(ROUTE);
    // assignedGeneralId null → reserve → Garrison stays Garrison (no floor).
    const res = await POST(req({ assignedGeneralId: null }), call);
    expect(res.status).toBe(200);
    expect(lastSet()).toEqual({ assignedGeneralId: null, theaterId: "reserve" });
  });
});
