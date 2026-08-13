import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { bulkOps, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/military/assign-branch/route";

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = {
  params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }),
};

let db: MockDb;
describe("POST assign-branch", () => {
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
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "u1", posture: "standard" },
        { _id: "u2", posture: "garrison" },
      ]),
    });
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

  it("assigns every unit of the branch and floors Garrison at a front", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "navy", assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      assigned: 2,
      assignedGeneralId: "gen1",
      theaterId: "afghan",
    });
    const ops = bulkOps(db.collectionMocks.militaryUnits.bulkWrite);
    expect(ops).toEqual([
      [
        { _id: "u1", countryId: "US" },
        { $set: { assignedGeneralId: "gen1", theaterId: "afghan" } },
      ],
      [
        { _id: "u2", countryId: "US" },
        { $set: { assignedGeneralId: "gen1", theaterId: "afghan", posture: "standard" } },
      ],
    ]);
  });

  it("clears the branch to General Staff without writing when there are no units", async () => {
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "navy", assignedGeneralId: null }), call);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      assigned: 0,
      assignedGeneralId: null,
      theaterId: "reserve",
    });
    expect(db.collectionMocks.militaryUnits.bulkWrite).not.toHaveBeenCalled();
  });

  it("400s an unknown branch without writing", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "space-marines", assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.bulkWrite).not.toHaveBeenCalled();
  });

  it("400s a general who is not commissioned, without writing", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: "gen1",
      commissioned: false,
      general: null,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "navy", assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.bulkWrite).not.toHaveBeenCalled();
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "navy", assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(403);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "navy", assignedGeneralId: "gen1" }), call);
    expect(res.status).toBe(404);
  });
});
