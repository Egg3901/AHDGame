import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/theaters/route";

// A single unit worth a large pool so small commitments are within budget.
function unitDoc() {
  return {
    _id: "u1",
    basePower: 100,
    posture: "standard",
    techTier: 1,
    vet: 1,
    equipment: { firepower: 1, protection: 1, support: 1 },
  };
}
function req(body: unknown) {
  return new Request("http://x", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("PUT theaters", () => {
  let db: MockDb;
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
    db.collection("theaterState");
    db.collection("conflicts");
    // "afghan" is the one live conflict; commitments are validated against it.
    db.collectionMocks.conflicts.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "afghan" }]),
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([unitDoc()]),
    });
    db.collectionMocks.theaterState.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("saves a valid commitment within the pool (upsert)", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ cohesion: 80, committed: { afghan: 10 } }), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.theaterState.updateOne).toHaveBeenCalled();
  });

  it("400s a commitment exceeding the pool without writing", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ cohesion: 80, committed: { afghan: 99999 } }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.theaterState.updateOne).not.toHaveBeenCalled();
  });

  it("400s an unknown theater id without writing", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ cohesion: 80, committed: { atlantis: 5 } }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.theaterState.updateOne).not.toHaveBeenCalled();
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ cohesion: 80, committed: { afghan: 10 } }), call);
    expect(res.status).toBe(403);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ cohesion: 80, committed: { afghan: 10 } }), call);
    expect(res.status).toBe(404);
  });
});
