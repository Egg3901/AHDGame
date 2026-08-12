import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/formations/route";

function assignment(over: Record<string, unknown> = {}) {
  return {
    theaterId: "afghan",
    generalCharacterId: "char_9",
    inCharge: true,
    ...over,
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

describe("PUT formations", () => {
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
    db.collection("militaryFormations");
    db.collection("characters");
    db.collection("characterGenerals");
    db.collection("conflicts");
    // Postings validate their theaterId against live conflicts; "afghan" is live.
    // The doc itself is read, not just counted: a posting to a PROXY war is refused
    // unless the country is already a belligerent, so the gate needs the rosters.
    // This one is an ordinary interstate war, which that narrowing must not catch.
    db.collectionMocks.conflicts.countDocuments.mockResolvedValue(1);
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      _id: "afghan",
      type: "war",
      sideA: { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" },
      sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([{ _id: "u1" }, { _id: "u2" }]) }),
    });
    db.collectionMocks.militaryFormations.updateOne.mockResolvedValue({ matchedCount: 1 });
    // The country's real commissioned generals.
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({
        toArray: vi.fn().mockResolvedValue([{ _id: "char_9", name: "Gen. Real" }]),
      }),
    });
    db.collectionMocks.characterGenerals.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          characterId: "char_9",
          general: { name: "Gen. Real", spec: "armor", level: 2, traits: [] },
        },
      ]),
    });
  });

  it("saves roles (upsert)", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ positions: { u1: "frontline" } }), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.militaryFormations.updateOne).toHaveBeenCalled();
  });

  it("saves conflict assignments", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ positions: {}, conflictAssignments: [assignment()] }), call);
    expect(res.status).toBe(200);
  });

  // The Combat Command page owns roles; the SecDef office owns assignments. Each
  // must patch only its own half, or whichever saved last would wipe the other.
  it("saving assignments alone does not touch stored roles", async () => {
    const { PUT } = await import(ROUTE);
    await PUT(req({ conflictAssignments: [assignment()] }), call);
    const update = db.collectionMocks.militaryFormations.updateOne.mock.calls[0][1];
    expect(update.$set).toHaveProperty("conflictAssignments");
    expect(update.$set).not.toHaveProperty("positions");
  });

  // Re-posting a general from the SecDef office moves the units assigned to them,
  // exactly as the CG page does — so the office route reconciles theaters too.
  it("reconciles unit theaters when assignments are saved", async () => {
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      project: () => ({
        toArray: vi
          .fn()
          .mockResolvedValue([{ _id: "unitA", theaterId: "reserve", assignedGeneralId: "char_9" }]),
      }),
    });
    const { PUT } = await import(ROUTE);
    await PUT(
      req({
        conflictAssignments: [assignment({ generalCharacterId: "char_9", theaterId: "afghan" })],
      }),
      call
    );
    const bulk = db.collectionMocks.militaryUnits.bulkWrite.mock.calls[0][0];
    expect(bulk).toEqual([
      { updateOne: { filter: { _id: "unitA" }, update: { $set: { theaterId: "afghan" } } } },
    ]);
  });

  it("does not reconcile theaters when only roles are saved", async () => {
    const { PUT } = await import(ROUTE);
    await PUT(req({ positions: { u1: "frontline" } }), call);
    expect(db.collectionMocks.militaryUnits.bulkWrite).not.toHaveBeenCalled();
  });

  it("saving roles alone does not touch stored assignments", async () => {
    const { PUT } = await import(ROUTE);
    await PUT(req({ positions: { u1: "frontline" } }), call);
    const update = db.collectionMocks.militaryFormations.updateOne.mock.calls[0][1];
    expect(update.$set).toHaveProperty("positions");
    expect(update.$set).not.toHaveProperty("conflictAssignments");
  });

  it("400s an empty patch rather than writing nothing", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({}), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryFormations.updateOne).not.toHaveBeenCalled();
  });

  // Regression: the retired `general: z.any()` let a defense holder POST a fabricated
  // max-level general straight into battle math. A general is now a characterId
  // checked against the country's roster, and stats resolve server-side.
  it("400s an assignment naming a general who is not this country's", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({
        positions: {},
        conflictAssignments: [assignment({ generalCharacterId: "fabricated" })],
      }),
      call
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryFormations.updateOne).not.toHaveBeenCalled();
  });

  it("400s two theater commanders at one conflict", async () => {
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({
        toArray: vi.fn().mockResolvedValue([
          { _id: "char_9", name: "A" },
          { _id: "char_8", name: "B" },
        ]),
      }),
    });
    db.collectionMocks.characterGenerals.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { characterId: "char_9", general: { name: "A", spec: "armor", level: 2, traits: [] } },
        { characterId: "char_8", general: { name: "B", spec: "armor", level: 2, traits: [] } },
      ]),
    });
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({
        positions: {},
        conflictAssignments: [
          assignment({ generalCharacterId: "char_9", inCharge: true }),
          assignment({ generalCharacterId: "char_8", inCharge: true }),
        ],
      }),
      call
    );
    expect(res.status).toBe(400);
  });

  it("400s an unknown theater", async () => {
    db.collectionMocks.conflicts.countDocuments.mockResolvedValue(0); // no such conflict
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({ positions: {}, conflictAssignments: [assignment({ theaterId: "atlantis" })] }),
      call
    );
    expect(res.status).toBe(400);
  });

  it("400s an invalid role in positions", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ positions: { u1: "not-a-role" } }), call);
    expect(res.status).toBe(400);
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ positions: {} }), call);
    expect(res.status).toBe(403);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ positions: {} }), call);
    expect(res.status).toBe(404);
  });
});
